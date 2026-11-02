const express = require('express');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const roleRoutes = require('./routes/roleRoutes');
const auditRoutes = require('./routes/auditRoutes');
const patientRoutes = require('./routes/patientRoutes');
const prescriptionRoutes = require('./routes/prescriptionRoutes');

const app = express();

// Performance monitoring middleware (NFR-PERF-01 / US-15)
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const originalSend = res.send;
  res.send = function(...args) {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${durationMs.toFixed(2)}ms`);
    }
    return originalSend.apply(this, args);
  };
  next();
});

// Parse incoming JSON requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// Mount API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/portal', roleRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/patients', patientRoutes);
app.use('/api/v1/prescriptions', prescriptionRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    system: 'Hospital Management System',
    timestamp: new Date().toISOString()
  });
});

// System performance verification endpoint (NFR-PERF-01 / US-15)
app.get('/api/v1/system/performance', (req, res) => {
  const memory = process.memoryUsage();
  res.status(200).json({
    status: 'healthy',
    targetResponseTimeMs: 500,
    concurrencyTargetUsers: 200,
    systemUptime: process.uptime(),
    memoryUsageMB: {
      rss: (memory.rss / (1024 * 1024)).toFixed(2),
      heapUsed: (memory.heapUsed / (1024 * 1024)).toFixed(2),
      heapTotal: (memory.heapTotal / (1024 * 1024)).toFixed(2)
    },
    timestamp: new Date().toISOString()
  });
});

// Centralized 404 handler
app.use((req, res) => {
  res.status(404).json({
    type: 'https://hms.hospital.com/errors/not-found',
    title: 'Resource Not Found',
    status: 404,
    detail: `Endpoint ${req.method} ${req.originalUrl} does not exist.`
  });
});

// Centralized RFC 7807 global error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    type: err.type || 'https://hms.hospital.com/errors/internal-server-error',
    title: err.title || 'Internal Server Error',
    status,
    detail: err.message || 'An unexpected error occurred.'
  });
});

module.exports = app;
