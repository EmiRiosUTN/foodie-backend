module.exports = {
  apps: [
    {
      name: "foodie-backend",
      cwd: __dirname,
      script: "dist/main.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      max_restarts: 8,
      exp_backoff_restart_delay: 100,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 4000
      }
    }
  ]
};
