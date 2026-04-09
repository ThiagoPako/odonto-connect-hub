module.exports = {
  apps: [
    {
      name: 'odonto-connect',
      script: 'npm',
      args: 'run preview -- --host 127.0.0.1 --port 3000',
      cwd: '/root/odonto-connect',
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'odonto-api',
      script: './vps-api-server/server.mjs',
      cwd: '/root/odonto-connect',
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
