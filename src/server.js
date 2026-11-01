const app = require('./app');
const config = require('./config');

const server = app.listen(config.PORT, () => {
  console.log(`Hospital Management System (HMS) server running on http://localhost:${config.PORT}`);
  console.log(`Ready for Sprint 1 demo.`);
});

module.exports = server;
