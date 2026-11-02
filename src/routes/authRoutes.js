const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const authenticateToken = require('../middleware/auth');

// POST /api/v1/auth/register (US-01 / FR-AUTH-01)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const result = await authService.register({
      name,
      email,
      password,
      role,
      clientIp
    });

    return res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: 'https://hms.hospital.com/errors/registration-failed',
      title: 'Registration Error',
      status,
      detail: error.message
    });
  }
});

// POST /api/v1/auth/login (US-01, US-02 / FR-AUTH-01, FR-AUTH-02, FR-AUTH-03)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress;

    const result = await authService.login({
      email,
      password,
      clientIp
    });

    return res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: result
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      type: error.locked
        ? 'https://hms.hospital.com/errors/account-locked'
        : 'https://hms.hospital.com/errors/invalid-credentials',
      title: error.locked ? 'Account Locked' : 'Authentication Failed',
      status,
      detail: error.message,
      locked: !!error.locked,
      attemptsRemaining: error.attemptsRemaining
    });
  }
});

// GET /api/v1/auth/me (Protected current user session)
router.get('/me', authenticateToken, (req, res) => {
  return res.status(200).json({
    status: 'success',
    data: {
      user: req.user
    }
  });
});

module.exports = router;
