module.exports = {
  apps : [{
    name: 'health-storage',
		cwd: __dirname,
    script: 'src/server.js',
		args: '--max-http-header-size=15000',
    instances: 1,
    autorestart: true,
    watch: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
