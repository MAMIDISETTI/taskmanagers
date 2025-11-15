const express = require('express');
const { protect, adminOnly } = require('../middlewares/authMiddleware');
const { getCandidateDashboardData, getCandidateDashboardDetail } = require('../controllers/candidateDashboardController');

const router = express.Router();

// @route   POST /api/admin/candidate-dashboard
// @desc    Get candidate dashboard data
// @access  Private (Admin)
router.post('/', protect, adminOnly, getCandidateDashboardData);

// @route   POST /api/admin/candidate-dashboard/detail
// @desc    Get detailed candidate dashboard data
// @access  Private (Admin)
router.post('/detail', protect, adminOnly, getCandidateDashboardDetail);

module.exports = router;
