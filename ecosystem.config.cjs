const commonApp = {
  cwd: __dirname,
  autorestart: true,
  restart_delay: 5000,
  max_restarts: 20,
  time: true,
  node_args: '--enable-source-maps',
  env: {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    LOG_FORMAT: 'json',
  },
};

module.exports = {
  apps: [
    {
      ...commonApp,
      name: 'wordping-api',
      script: 'dist/api/index.js',
    },
    {
      ...commonApp,
      name: 'wordping-bot',
      script: 'dist/bot/index.js',
    },
    {
      ...commonApp,
      name: 'wordping-worker',
      script: 'dist/scheduler/worker.js',
    },
    {
      ...commonApp,
      name: 'wordping-news-worker',
      script: 'dist/scheduler/newsWorker.js',
    },
  ],
};
