module.exports = {
  apps : [{
    name: 'health-storage',
		cwd: __dirname,
    script: 'src/server.js',
		args: '--max-http-header-size=15000',
    instances: 1,
    autorestart: false,
		ignore_watch: ["log", "out"],
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
