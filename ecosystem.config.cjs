module.exports = {
  apps: [
    // odonto-connect (vite preview, porta 3000) removido: o nginx serve o frontend estático (docs/operacao/frontend-nginx.md).
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
        TZ: 'America/Sao_Paulo',
      },
    },
  ],
};
