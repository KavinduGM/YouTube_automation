// PM2 process file. Deploy on the VPS:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: 'yt-api',
      cwd: '/opt/youtube-automation',
      script: 'apps/api/dist/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
    },
    {
      name: 'yt-worker',
      cwd: '/opt/youtube-automation',
      script: 'apps/worker/dist/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1500M', // Drive downloads can use memory
    },
    {
      name: 'yt-dashboard',
      cwd: '/opt/youtube-automation/apps/dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
    },
  ],
};
