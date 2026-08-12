import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RequestUser } from "../../common/auth/request-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { PreferredFeature } from "../reservations/preferred-features";
import { ReservationsService } from "../reservations/reservations.service";

type Schedule = { isEnabled: boolean; startTime: string; endTime: string; intervalMin: number; service?: "lunch" | "dinner" };
const requests = new Map<string, number[]>();

function serviceDate(date: string) { return new Date(`${date}T00:00:00.000Z`); }
function weekday(date: string, timezone: string) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day);
}
function timeToMinutes(value: string) { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
function minutesToTime(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }

@Injectable()
export class OnlineBookingsService {
  constructor(private readonly prisma: PrismaService, private readonly reservations: ReservationsService, private readonly audit: AuditService) {}

  private assertOwner(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId || user.role !== "restaurant_owner") throw new ForbiddenException("Only the restaurant owner can manage online bookings");
    return user.restaurantId;
  }
  private limit(key: string) {
    const now = Date.now(); const active = (requests.get(key) || []).filter((at) => at > now - 60_000);
    if (active.length >= 30) throw new HttpException("Too many requests. Please try again shortly.", HttpStatus.TOO_MANY_REQUESTS);
    active.push(now); requests.set(key, active);
  }
  private async restaurantBySlug(slug: string) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { slug }, include: { customization: true, onlineBooking: true, branches: { orderBy: { createdAt: "asc" } } } });
    if (!restaurant || !restaurant.isActive) throw new NotFoundException("Restaurant not found");
    if (!restaurant.onlineBooking?.isEnabled) throw new ConflictException("Online bookings are currently unavailable");
    return restaurant;
  }
  private async schedulesFor(restaurantId: string, branchId: string, date: string, timezone: string): Promise<Schedule[]> {
    const exception = await this.prisma.bookingException.findFirst({ where: { restaurantId, branchId, serviceDate: serviceDate(date) } });
    if (exception) {
      if (exception.type !== "custom_hours") return [];
      const windows = Array.isArray(exception.windows) ? exception.windows : [];
      return windows.filter((item): item is { startTime: string; endTime: string; intervalMin?: number; service?: "lunch" | "dinner" } => Boolean(item && typeof item === "object" && "startTime" in item && "endTime" in item)).map((item) => ({ isEnabled: true, startTime: item.startTime, endTime: item.endTime, intervalMin: item.intervalMin || 30, service: item.service }));
    }
    const windows = await this.prisma.bookingWindow.findMany({ where: { restaurantId, branchId, weekday: weekday(date, timezone), isEnabled: true }, orderBy: [{ service: "asc" }, { startTime: "asc" }] });
    if (windows.length) return windows;
    const legacy = await this.prisma.onlineBookingException.findFirst({ where: { restaurantId, branchId, serviceDate: serviceDate(date) } });
    if (legacy) return legacy.isClosed || !legacy.startTime || !legacy.endTime || !legacy.intervalMin ? [] : [{ isEnabled: true, startTime: legacy.startTime, endTime: legacy.endTime, intervalMin: legacy.intervalMin }];
    const legacySchedule = await this.prisma.onlineBookingSchedule.findFirst({ where: { restaurantId, branchId, weekday: weekday(date, timezone), isEnabled: true } });
    return legacySchedule ? [legacySchedule] : [];
  }
  private async resolveBranch(restaurantId: string, publicSlug: string) {
    const branch = await this.prisma.branch.findFirst({ where: { restaurantId, publicSlug } });
    if (!branch) throw new NotFoundException("Branch not found");
    return branch;
  }
  private validateWindow(date: string, settings: { minAdvanceMinutes: number; maxAdvanceDays: number; maximumAdvanceValue?: number; maximumAdvanceUnit?: "days" | "weeks" | "months" }, timezone: string) {
    const now = new Date();
    const max = new Date(now);
    const amount = settings.maximumAdvanceValue || settings.maxAdvanceDays;
    if (settings.maximumAdvanceUnit === "months") max.setMonth(max.getMonth() + amount); else max.setDate(max.getDate() + amount * (settings.maximumAdvanceUnit === "weeks" ? 7 : 1));
    const selected = new Date(`${date}T12:00:00Z`);
    if (selected > max || Number.isNaN(selected.getTime())) throw new BadRequestException("Selected date is outside the booking window");
    const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
    if (date < localToday) throw new BadRequestException("Selected date is no longer available");
  }
  private async minimumAdvance(restaurantId: string, date: string, time: string, timezone: string, fallback: number) {
    const service = timeToMinutes(time) < 17 * 60 ? "lunch" : "dinner";
    const rule = await this.prisma.bookingCutoffRule.findFirst({ where: { restaurantId, service, weekdays: { has: weekday(date, timezone) } } });
    if (!rule) return fallback;
    const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return rule.sameDayOnly && date !== localToday ? fallback : rule.minimumAdvanceMinutes;
  }
  private meetsAdvance(date: string, time: string, minAdvanceMinutes: number, timezone: string) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
    const today = `${get("year")}-${get("month")}-${get("day")}`;
    return date !== today || timeToMinutes(time) >= timeToMinutes(`${get("hour")}:${get("minute")}`) + minAdvanceMinutes;
  }

  async getOwnerConfig(user: RequestUser) {
    const restaurantId = this.assertOwner(user);
    const [restaurant, settings, schedules, exceptions] = await Promise.all([
      this.prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { name: true, slug: true, profileImageUrl: true, branches: { select: { id: true, name: true, publicSlug: true, timezone: true, onlineBookingDurationMinutes: true }, orderBy: { createdAt: "asc" } } } }),
      this.prisma.onlineBookingSettings.findUnique({ where: { restaurantId } }),
      this.prisma.onlineBookingSchedule.findMany({ where: { restaurantId }, orderBy: [{ branchId: "asc" }, { weekday: "asc" }] }),
      this.prisma.onlineBookingException.findMany({ where: { restaurantId }, orderBy: { serviceDate: "asc" } })
    ]);
    return { restaurant, settings: settings || { isEnabled: false, coverImageUrl: null, whatsappPhone: null, accentColor: "#FF5A00", minAdvanceMinutes: 60, maxAdvanceDays: 60, minPartySize: 1, maxPartySize: 12 }, schedules, exceptions: exceptions.map((item) => ({ ...item, serviceDate: item.serviceDate.toISOString().slice(0, 10) })) };
  }

  async saveOwnerConfig(user: RequestUser, input: { isEnabled: boolean; coverImageUrl?: string | null; whatsappPhone?: string | null; accentColor: string; minAdvanceMinutes: number; maxAdvanceDays: number; minPartySize: number; maxPartySize: number; branchDurations?: Array<{ branchId: string; durationMinutes: number }>; schedules: Array<{ branchId: string; weekday: number; isEnabled: boolean; startTime: string; endTime: string; intervalMin: number }>; exceptions: Array<{ branchId: string; serviceDate: string; isClosed: boolean; startTime?: string; endTime?: string; intervalMin?: number }> }) {
    const restaurantId = this.assertOwner(user);
    const branchIds = new Set((await this.prisma.branch.findMany({ where: { restaurantId }, select: { id: true } })).map((item) => item.id));
    if ([...input.schedules, ...input.exceptions, ...(input.branchDurations || [])].some((item) => !branchIds.has(item.branchId))) throw new ForbiddenException("Invalid branch");
    if (input.schedules.some((item) => timeToMinutes(item.endTime) <= timeToMinutes(item.startTime))) throw new BadRequestException("End time must be after start time");
    if (input.exceptions.some((item) => !item.isClosed && (!item.startTime || !item.endTime || timeToMinutes(item.endTime) <= timeToMinutes(item.startTime)))) throw new BadRequestException("Invalid date exception");
    await this.prisma.$transaction(async (tx) => {
      const settingsData = { isEnabled: input.isEnabled, coverImageUrl: input.coverImageUrl || null, ...(input.whatsappPhone === undefined ? {} : { whatsappPhone: input.whatsappPhone || null }), accentColor: input.accentColor, minAdvanceMinutes: input.minAdvanceMinutes, maxAdvanceDays: input.maxAdvanceDays, minPartySize: input.minPartySize, maxPartySize: input.maxPartySize };
      await tx.onlineBookingSettings.upsert({ where: { restaurantId }, create: { restaurantId, ...settingsData }, update: settingsData });
      await Promise.all((input.branchDurations || []).map((item) => tx.branch.update({ where: { id: item.branchId }, data: { onlineBookingDurationMinutes: item.durationMinutes } })));
      await tx.onlineBookingSchedule.deleteMany({ where: { restaurantId } });
      if (input.schedules.length) await tx.onlineBookingSchedule.createMany({ data: input.schedules.map((item) => ({ ...item, restaurantId })) });
      // Keep the legacy editor compatible while the new multi-window editor is
      // introduced: every saved weekly rule is mirrored to the unified source.
      await tx.bookingWindow.deleteMany({ where: { restaurantId } });
      if (input.schedules.length) await tx.bookingWindow.createMany({ data: input.schedules.map((item) => ({ restaurantId, branchId: item.branchId, weekday: item.weekday, service: timeToMinutes(item.startTime) < 17 * 60 ? "lunch" : "dinner", isEnabled: item.isEnabled, startTime: item.startTime, endTime: item.endTime, intervalMin: item.intervalMin })) });
      await tx.onlineBookingException.deleteMany({ where: { restaurantId } });
      if (input.exceptions.length) await tx.onlineBookingException.createMany({ data: input.exceptions.map((item) => ({ ...item, restaurantId, serviceDate: serviceDate(item.serviceDate), startTime: item.isClosed ? null : item.startTime, endTime: item.isClosed ? null : item.endTime, intervalMin: item.isClosed ? null : item.intervalMin || 30 })) });
    });
    await this.audit.log({ action: "online_booking.updated", targetType: "restaurant", targetId: restaurantId, restaurantId, restaurantUserId: user.sub });
    return this.getOwnerConfig(user);
  }

  async getPublicProfile(slug: string) {
    const restaurant = await this.restaurantBySlug(slug);
    const tables = await this.prisma.table.findMany({ where: { restaurantId: restaurant.id, isReservable: true }, select: { metadata: true } });
    const supportedFeatures = (["nearWindow", "nearColumn", "nearWall", "nearCorridor", "hasWindowView"] as PreferredFeature[]).filter((feature) => tables.some((table) => {
      const metadata = table.metadata as { derivedFeatures?: Record<string, boolean>; manualFeatures?: { hasTvView?: boolean } } | null;
      return feature === "hasWindowView" ? metadata?.manualFeatures?.hasTvView === true : metadata?.derivedFeatures?.[feature] === true;
    }));
    const settings = restaurant.onlineBooking;
    const customization = restaurant.customization;
    return { name: restaurant.name, slug: restaurant.slug, logoUrl: restaurant.profileImageUrl, coverImageUrl: settings?.coverImageUrl || null, whatsappPhone: customization?.humanSupportWhatsapp || settings?.whatsappPhone || null, accentColor: settings?.accentColor || "#FF5A00", minPartySize: settings?.minPartySize || 1, maxPartySize: settings?.maxPartySize || 12, largePartyThreshold: settings?.largePartyThreshold || null, commentsEnabled: settings?.commentsEnabled ?? true, publicInfo: { address: settings?.showAddress ? customization?.address || null : null, phone: settings?.showPhone ? customization?.phone || null : null, menuUrl: settings?.showMenu ? customization?.menuUrl || null : null, instagramUrl: settings?.showInstagram ? customization?.instagramUrl || null : null, mapsUrl: settings?.showGoogleMaps ? customization?.mapsUrl || null : null }, supportedFeatures, branches: restaurant.branches.filter((branch) => branch.isEnabled && branch.publicBookingEnabled).map((branch) => ({ slug: branch.publicSlug, name: branch.publicName || branch.name })) };
  }

  async availability(slug: string, input: { branch: string; date: string; partySize: number; preferredFeatures: PreferredFeature[] }, ip: string, skipLimit = false) {
    if (!skipLimit) this.limit(`${ip}:${slug}:availability`);
    const restaurant = await this.restaurantBySlug(slug); const settings = restaurant.onlineBooking!;
    const branch = await this.resolveBranch(restaurant.id, input.branch);
    if (!branch.isEnabled || !branch.publicBookingEnabled) throw new NotFoundException("Branch not found");
    if (input.partySize < settings.minPartySize || input.partySize > settings.maxPartySize) throw new BadRequestException("Party size is outside the allowed range");
    this.validateWindow(input.date, settings, branch.timezone);
    if (settings.largePartyThreshold && input.partySize > settings.largePartyThreshold) return { date: input.date, partySize: input.partySize, slots: [], fallbackAction: "whatsapp" };
    const schedules = await this.schedulesFor(restaurant.id, branch.id, input.date, branch.timezone);
    if (!schedules.length) return { date: input.date, partySize: input.partySize, slots: [] };
    const slots: Array<{ time: string; available: boolean }> = [];
    for (const schedule of schedules) for (let minute = timeToMinutes(schedule.startTime); minute < timeToMinutes(schedule.endTime); minute += schedule.intervalMin) {
      const time = minutesToTime(minute);
      if (!this.meetsAdvance(input.date, time, await this.minimumAdvance(restaurant.id, input.date, time, branch.timezone, settings.minAdvanceMinutes), branch.timezone)) continue;
      const available = await this.reservations.findAvailableRoomForRestaurant({ restaurantId: restaurant.id, branchId: branch.id, partySize: input.partySize, serviceDate: input.date, serviceTime: time, preferredFeatures: input.preferredFeatures, durationMinutes: branch.onlineBookingDurationMinutes });
      if (available) slots.push({ time, available: true });
    }
    return { date: input.date, partySize: input.partySize, slots };
  }

  async validateSlot(slug: string, input: { branch: string; date: string; partySize: number; time: string; preferredFeatures: PreferredFeature[] }, ip: string) {
    const result = await this.availability(slug, input, ip);
    if (!result.slots.some((slot) => slot.time === input.time)) throw new ConflictException({ code: "SLOT_UNAVAILABLE", message: "This time is no longer available" });
    return { available: true };
  }

  async calendar(slug: string, input: { branch: string; month: string; partySize: number; preferredFeatures: PreferredFeature[] }, ip: string) {
    this.limit(`${ip}:${slug}:calendar`);
    const [year, month] = input.month.split("-").map(Number); const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dates = Array.from({ length: last }, (_, index) => `${input.month}-${String(index + 1).padStart(2, "0")}`);
    const restaurant = await this.restaurantBySlug(slug); const settings = restaurant.onlineBooking!;
    const branch = await this.resolveBranch(restaurant.id, input.branch);
    if (input.partySize < settings.minPartySize || input.partySize > settings.maxPartySize) throw new BadRequestException("Party size is outside the allowed range");
    const [schedules, exceptions] = await Promise.all([
      this.prisma.onlineBookingSchedule.findMany({ where: { restaurantId: restaurant.id, branchId: branch.id, isEnabled: true } }),
      this.prisma.onlineBookingException.findMany({ where: { restaurantId: restaurant.id, branchId: branch.id, serviceDate: { gte: serviceDate(dates[0]), lte: serviceDate(dates[dates.length - 1]) } } })
    ]);
    const schedulesByWeekday = new Map(schedules.map((schedule) => [schedule.weekday, schedule]));
    const exceptionsByDate = new Map(exceptions.map((exception) => [exception.serviceDate.toISOString().slice(0, 10), exception]));
    const availableDates: string[] = [];
    for (const date of dates) {
      try {
        this.validateWindow(date, settings, branch.timezone);
        const exception = exceptionsByDate.get(date);
        const schedule = exception
          ? (!exception.isClosed && exception.startTime && exception.endTime && exception.intervalMin ? exception : null)
          : schedulesByWeekday.get(weekday(date, branch.timezone));
        if (!schedule) continue;
        const { startTime, endTime, intervalMin } = schedule;
        if (!startTime || !endTime || !intervalMin) continue;
        for (let minute = timeToMinutes(startTime); minute < timeToMinutes(endTime); minute += intervalMin) {
          if (this.meetsAdvance(date, minutesToTime(minute), settings.minAdvanceMinutes, branch.timezone)) { availableDates.push(date); break; }
        }
      } catch { /* Closed and out-of-window dates remain unavailable. */ }
    }
    return { month: input.month, availableDates };
  }

  async createPublicReservation(slug: string, input: { branch: string; date: string; partySize: number; time: string; fullName: string; phone: string; notes?: string; preferredFeatures: PreferredFeature[]; website?: string }, ip: string) {
    this.limit(`${ip}:${slug}:create`);
    if (input.website) throw new BadRequestException("Unable to submit reservation");
    const restaurant = await this.restaurantBySlug(slug); const settings = restaurant.onlineBooking!;
    const branch = await this.resolveBranch(restaurant.id, input.branch);
    if (input.partySize < settings.minPartySize || input.partySize > settings.maxPartySize) throw new BadRequestException("Party size is outside the allowed range");
    this.validateWindow(input.date, settings, branch.timezone);
    const schedules = await this.schedulesFor(restaurant.id, branch.id, input.date, branch.timezone);
    const schedule = schedules.find((item) => timeToMinutes(input.time) >= timeToMinutes(item.startTime) && timeToMinutes(input.time) < timeToMinutes(item.endTime) && (timeToMinutes(input.time) - timeToMinutes(item.startTime)) % item.intervalMin === 0);
    if (!schedule) throw new ConflictException({ code: "SLOT_UNAVAILABLE", message: "This time is no longer available" });
    if (!this.meetsAdvance(input.date, input.time, await this.minimumAdvance(restaurant.id, input.date, input.time, branch.timezone, settings.minAdvanceMinutes), branch.timezone)) throw new ConflictException({ code: "SLOT_UNAVAILABLE", message: "This time is no longer available" });
    const available = await this.reservations.findAvailableRoomForRestaurant({ restaurantId: restaurant.id, branchId: branch.id, partySize: input.partySize, serviceDate: input.date, serviceTime: input.time, preferredFeatures: input.preferredFeatures, durationMinutes: branch.onlineBookingDurationMinutes });
    if (!available) throw new ConflictException({ code: "SLOT_UNAVAILABLE", message: "This time is no longer available" });
    try {
      const reservation = await this.reservations.createReservationForRestaurant(restaurant.id, { branchId: branch.id, roomId: available.roomId, fullName: input.fullName, phone: input.phone, partySize: input.partySize, serviceDate: input.date, serviceTime: input.time, preferredFeatures: input.preferredFeatures, notes: input.notes, durationMinutes: branch.onlineBookingDurationMinutes }, { source: "public_web" });
      return { code: reservation.code, date: input.date, time: reservation.serviceTime, partySize: reservation.partySize, branch: branch.name, restaurant: restaurant.name };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException({ code: "SLOT_UNAVAILABLE", message: "This time is no longer available" });
      throw error;
    }
  }
}
