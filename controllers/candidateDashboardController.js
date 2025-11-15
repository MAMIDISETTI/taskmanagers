const User = require('../models/User');
const UserNew = require('../models/UserNew');
const Joiner = require('../models/Joiner');
const MCQDeployment = require('../models/MCQDeployment');
const Result = require('../models/Result');
const Assignment = require('../models/Assignment');
const DayPlan = require('../models/DayPlan');
const Observation = require('../models/Observation');
const moment = require('moment');

// @desc    Get candidate dashboard data
// @route   POST /api/admin/candidate-dashboard
// @access  Private (Admin)
const getCandidateDashboardData = async (req, res) => {
  try {
    const { uids, dateFrom, dateTo } = req.body;

    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide candidate UIDs'
      });
    }

    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        success: false,
        message: 'Please provide date range'
      });
    }

    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999); // Include the entire end date


    const candidates = [];

    for (const uid of uids) {
      try {
        const searchTerm = uid.trim();
        
        // Check if search term is a valid MongoDB ObjectId
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(searchTerm);
        
        // Build search query - support employeeId, author_id, phone, phone_number, email, and _id
        const searchQuery = {
          $or: [
            { employeeId: searchTerm },
            { author_id: searchTerm },
            { phone: searchTerm },
            { phone_number: searchTerm },
            { email: searchTerm }
          ]
        };
        
        // Add _id search only if it's a valid ObjectId
        if (isObjectId) {
          searchQuery.$or.push({ _id: searchTerm });
        }
        
        // Search in UserNew model first
        let user = await UserNew.findOne(searchQuery);
        let userModel = 'UserNew';

        // If not found, search in User model
        if (!user) {
          user = await User.findOne(searchQuery);
          userModel = 'User';
        }

        if (!user) {
          continue;
        }

        // Get learning activity data
        const learningData = await getLearningActivityData(user, startDate, endDate);
        
        // Get assignment data
        const assignmentData = await getAssignmentData(user, startDate, endDate);
        
        // Get observation data
        const observationData = await getObservationData(user, startDate, endDate);

        // Calculate learning metrics
        const totalLearningHours = calculateTotalLearningHours(learningData);
        const dailyAverage = calculateDailyAverage(totalLearningHours, startDate, endDate);
        const learningStatus = calculateLearningStatus(assignmentData);
        const fortnightExams = calculateFortnightExams(learningData);

        const candidateData = {
          uid: user.employeeId || user.author_id || user._id.toString(),
          name: user.name || 'Unknown',
          email: user.email || 'N/A',
          dateOfJoining: user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB') : 'N/A',
          dateRange: `${dateFrom} to ${dateTo}`,
          learningStatus: learningStatus,
          currentCourse: getCurrentCourse(assignmentData),
          fortnightExams: fortnightExams,
          observations: observationData.observations || 'No observations available',
          totalHours: totalLearningHours.toFixed(1),
          dailyAverage: dailyAverage.toFixed(1),
          deploymentStatus: user.isDeployed || false,
          nativeState: user.state || 'Not specified',
          learningData: learningData,
          assignmentData: assignmentData
        };

        candidates.push(candidateData);

      } catch (error) {
        // Log error for debugging
        console.error(`Error processing candidate ${uid}:`, error.message);
        // Continue with other UIDs even if one fails
      }
    }

    res.json({
      success: true,
      candidates: candidates,
      totalCandidates: candidates.length,
      dateRange: {
        from: dateFrom,
        to: dateTo
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Helper function to get learning activity data
const getLearningActivityData = async (user, startDate, endDate) => {
  try {
    // Get MCQ results within date range
    const mcqResults = await MCQDeployment.find({
      'results.traineeId': user.author_id,
      'results.completedAt': {
        $gte: startDate,
        $lte: endDate
      }
    }).select('name results questions scheduledDateTime');

    // Get assignment results within date range
    const assignmentResults = await Result.find({
      userId: user._id,
      completedAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).populate('assignmentId', 'title description');

    // Get day plan activities within date range
    const dayPlanActivities = await DayPlan.find({
      userId: user._id,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    }).select('date activities timeSpent');

    return {
      mcqResults: mcqResults,
      assignmentResults: assignmentResults,
      dayPlanActivities: dayPlanActivities
    };
  } catch (error) {
    return { mcqResults: [], assignmentResults: [], dayPlanActivities: [] };
  }
};

// Helper function to get assignment data
const getAssignmentData = async (user, startDate, endDate) => {
  try {
    const assignments = await Assignment.find({
      assignedTo: user._id,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).select('title description status createdAt dueDate');

    return assignments;
  } catch (error) {
    return [];
  }
};

// Helper function to get observation data
const getObservationData = async (user, startDate, endDate) => {
  try {
    const observations = await Observation.find({
      traineeId: user._id,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).select('observation notes createdAt').populate('trainerId', 'name');

    return {
      observations: observations.map(obs => 
        `${obs.observation} - ${obs.notes} (${new Date(obs.createdAt).toLocaleDateString()})`
      ).join('; ')
    };
  } catch (error) {
    return { observations: 'No observations available' };
  }
};

// Helper function to calculate total learning hours
const calculateTotalLearningHours = (learningData) => {
  let totalHours = 0;

  // Calculate from day plan activities
  learningData.dayPlanActivities.forEach(activity => {
    if (activity.timeSpent) {
      totalHours += activity.timeSpent / 60; // Convert minutes to hours
    }
  });

  // Calculate from MCQ results (estimate based on time spent)
  learningData.mcqResults.forEach(deployment => {
    deployment.results.forEach(result => {
      if (result.timeSpent) {
        totalHours += result.timeSpent / 3600; // Convert seconds to hours
      }
    });
  });

  return totalHours;
};

// Helper function to calculate daily average
const calculateDailyAverage = (totalHours, startDate, endDate) => {
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  return daysDiff > 0 ? totalHours / daysDiff : 0;
};

// Helper function to calculate learning status
const calculateLearningStatus = (assignmentData) => {
  if (assignmentData.length === 0) {
    return 'No assignments';
  }

  const completed = assignmentData.filter(assignment => assignment.status === 'completed').length;
  const total = assignmentData.length;
  const percentage = Math.round((completed / total) * 100);

  return `${completed}/${total} assignments completed (${percentage}%)`;
};

// Helper function to calculate fortnight exams
const calculateFortnightExams = (learningData) => {
  const mcqCount = learningData.mcqResults.length;
  const totalScore = learningData.mcqResults.reduce((sum, deployment) => {
    return sum + deployment.results.reduce((deploymentSum, result) => {
      return deploymentSum + (result.totalScore || 0);
    }, 0);
  }, 0);

  const averageScore = mcqCount > 0 ? Math.round(totalScore / mcqCount) : 0;

  return `${mcqCount} exams completed (${averageScore}% average)`;
};

// Helper function to get current course
const getCurrentCourse = (assignmentData) => {
  const activeAssignments = assignmentData.filter(assignment => 
    assignment.status === 'in_progress' || assignment.status === 'pending'
  );

  if (activeAssignments.length === 0) {
    return 'No active courses';
  }

  return activeAssignments[0].title || 'Active Course';
};

// @desc    Get detailed candidate dashboard data
// @route   POST /api/admin/candidate-dashboard/detail
// @access  Private (Admin)
const getCandidateDashboardDetail = async (req, res) => {
  try {
    const { uid, dateFrom, dateTo } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: 'Please provide candidate UID'
      });
    }

    const startDate = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateTo ? new Date(dateTo) : new Date();
    endDate.setHours(23, 59, 59, 999);

    // Find user
    const searchTerm = uid.trim();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(searchTerm);
    
    const searchQuery = {
      $or: [
        { employeeId: searchTerm },
        { author_id: searchTerm },
        { phone: searchTerm },
        { phone_number: searchTerm },
        { email: searchTerm }
      ]
    };
    
    if (isObjectId) {
      searchQuery.$or.push({ _id: searchTerm });
    }
    
    let user = await UserNew.findOne(searchQuery);
    if (!user) {
      user = await User.findOne(searchQuery);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Get joiner data for additional personal details
    let joiner = null;
    try {
      joiner = await Joiner.findOne({
        $or: [
          { candidate_personal_mail_id: user.email },
          { email: user.email },
          { name: user.name },
          { employeeId: user.employeeId }
        ]
      });
    } catch (err) {
      console.error('Error fetching joiner:', err);
    }

    // Personal Details
    const personalDetails = {
      uid: user.author_id || user._id.toString(),
      name: user.name || joiner?.candidate_name || 'Unknown',
      phoneNumber: user.phone_number || user.phone || joiner?.phone_number || joiner?.phone || 'N/A',
      email: user.email || user.candidate_personal_mail_id || joiner?.candidate_personal_mail_id || joiner?.email || 'N/A',
      employeeId: user.employeeId || joiner?.employeeId || 'N/A',
      doj: user.date_of_joining || user.joiningDate || joiner?.date_of_joining || joiner?.joiningDate 
        ? moment(user.date_of_joining || user.joiningDate || joiner?.date_of_joining || joiner?.joiningDate).format('DD-MMM-YYYY')
        : 'N/A',
      state: user.state || joiner?.state || 'N/A',
      highestQualification: user.qualification || joiner?.qualification || 'N/A',
      specialization: user.specialization || joiner?.specialization || 'N/A',
      haveMTechPC: user.haveMTechPC || joiner?.haveMTechPC || 'N/A',
      haveMTechOD: user.haveMTechOD || joiner?.haveMTechOD || 'N/A',
      yearOfPassout: user.yearOfPassout || joiner?.yearOfPassout || 'N/A',
      workingStatus: user.isDeployed ? 'Working' : (joiner?.workingStatus || 'Not Working')
    };

    // Get all results for learning report - try multiple ways to find results
    let allResults = await Result.find({
      author_id: user.author_id,
      exam_date: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ exam_date: 1 });

    // If no results found with date filter, try without date filter
    if (allResults.length === 0) {
      allResults = await Result.find({
        author_id: user.author_id
      }).sort({ exam_date: -1 });
    }

    // Also try with email matching if still no results
    if (allResults.length === 0 && user.email) {
      allResults = await Result.find({
        email: user.email
      }).sort({ exam_date: -1 });
    }

    // Get demo data
    const demoData = user.demo_managements_details || [];

    // Define subjects (from the image)
    const subjects = ['Static', 'Responsive', 'Modern Responsive', 'Dynamic', 'Python', 'SQL', 'JS', 'Node JS', 'React JS', 'Mini projects'];

    // Map Fortnight exam numbers to subjects
    // Fortnight 1 = Static, Fortnight 2 = Responsive, Fortnight 3 = Modern Responsive, etc.
    const fortnightToSubjectMap = {
      1: 'Static',
      2: 'Responsive',
      3: 'Modern Responsive',
      4: 'Dynamic',
      5: 'Python',
      6: 'SQL',
      7: 'JS',
      8: 'Node JS',
      9: 'React JS',
      10: 'Mini projects'
    };

    // Helper to extract subject from exam_type or result_name
    const extractSubject = (examType, resultName) => {
      const text = (examType || resultName || '').toLowerCase();
      
      // First, check if it's a fortnight exam and map by number
      const fortnightMatch = text.match(/fortnight\s*(\d+)/i);
      if (fortnightMatch) {
        const fortnightNum = parseInt(fortnightMatch[1]);
        if (fortnightToSubjectMap[fortnightNum]) {
          return fortnightToSubjectMap[fortnightNum];
        }
      }
      
      // Fallback to text matching
      for (const subject of subjects) {
        if (text.includes(subject.toLowerCase())) {
          return subject;
        }
      }
      // Try to match partial names
      if (text.includes('static')) return 'Static';
      if (text.includes('responsive')) {
        if (text.includes('modern')) return 'Modern Responsive';
        return 'Responsive';
      }
      if (text.includes('dynamic')) return 'Dynamic';
      if (text.includes('python')) return 'Python';
      if (text.includes('sql')) return 'SQL';
      if (text.includes('javascript') || text.includes('js')) {
        if (text.includes('node')) return 'Node JS';
        if (text.includes('react')) return 'React JS';
        return 'JS';
      }
      if (text.includes('react')) return 'React JS';
      if (text.includes('node')) return 'Node JS';
      if (text.includes('mini') || text.includes('project')) return 'Mini projects';
      return null;
    };

    // Group results by subject and exam type
    const learningDataBySubject = {};
    subjects.forEach(subject => {
      learningDataBySubject[subject] = {
        dailyQuizzes: [],
        fortnightExams: [],
        courseExams: [],
        onlineDemos: [],
        offlineDemos: []
      };
    });

    // Process results
    allResults.forEach(result => {
      const subject = extractSubject(result.exam_type, result.result_name || result.trainee_name);
      if (!subject) return;

      const examType = (result.exam_type || '').toLowerCase();
      if (examType.startsWith('daily')) {
        learningDataBySubject[subject].dailyQuizzes.push(result);
      } else if (examType.startsWith('fortnight')) {
        learningDataBySubject[subject].fortnightExams.push(result);
      } else if (examType.startsWith('course')) {
        learningDataBySubject[subject].courseExams.push(result);
      }
    });

    // Process demo data
    demoData.forEach(demo => {
      const subject = extractSubject(demo.courseTag || demo.subject || demo.course || demo.title || '', demo.name || '');
      if (!subject) return;

      const demoType = (demo.type || '').toLowerCase();
      if (demoType === 'online' || demoType === 'online_demo') {
        learningDataBySubject[subject].onlineDemos.push(demo);
      } else {
        learningDataBySubject[subject].offlineDemos.push(demo);
      }
    });

    // Build Learning Report metrics
    const learningMetrics = [
      {
        label: 'Daily Quiz counts',
        values: {}
      },
      {
        label: 'Daily Quiz attempts count',
        values: {}
      },
      {
        label: 'Daily Quiz score Average in %',
        values: {}
      },
      {
        label: 'Fort night exam counts',
        values: {}
      },
      {
        label: 'Fort night exam attempts counts',
        values: {}
      },
      {
        label: 'Fort night exam score Average',
        values: {}
      },
      {
        label: 'Course exam attempts',
        values: {}
      },
      {
        label: 'Course exam score in %',
        values: {}
      },
      {
        label: 'Online demo counts',
        values: {}
      },
      {
        label: 'Online demo ratings Average',
        values: {}
      },
      {
        label: 'Offline demo counts',
        values: {}
      },
      {
        label: 'Offline demo ratings Average',
        values: {}
      },
      {
        label: 'No.of weeks expected complete the course',
        values: {}
      },
      {
        label: 'No.of weeks taken complete the course',
        values: {}
      }
    ];

    // Calculate total fortnight exam counts and attempts across all subjects
    // User requirement: "only one Fortnight Exam count" and "only one Fortnight Exam attempts count"
    // This means show 1 (indicating there's one fortnight exam count metric), not the actual count
    let totalFortnightExams = 1; // Always show 1 (one fortnight exam count metric)
    let totalFortnightAttempts = 1; // Always show 1 (one fortnight exam attempts count metric)
    let totalFortnightScore = 0;
    const uniqueFortnightNumbers = new Set();
    let actualAttempts = 0; // Track actual attempts for average calculation
    
    // Collect all fortnight exams and calculate average
    allResults.forEach(result => {
      const examType = (result.exam_type || '').toLowerCase();
      if (examType.startsWith('fortnight')) {
        const fortnightMatch = examType.match(/fortnight\s*(\d+)/i);
        if (fortnightMatch) {
          const fortnightNum = parseInt(fortnightMatch[1]);
          uniqueFortnightNumbers.add(fortnightNum);
          actualAttempts++;
          totalFortnightScore += (result.percentage || 0);
        }
      }
    });
    
    // Calculate average based on actual attempts
    const overallFortnightAvg = actualAttempts > 0
      ? Math.round(totalFortnightScore / actualAttempts)
      : '';

    subjects.forEach(subject => {
      const data = learningDataBySubject[subject];
      
      // Daily Quiz metrics
      learningMetrics[0].values[subject] = data.dailyQuizzes.length || '';
      learningMetrics[1].values[subject] = data.dailyQuizzes.length || '';
      const dailyAvg = data.dailyQuizzes.length > 0
        ? Math.round(data.dailyQuizzes.reduce((sum, q) => sum + (q.percentage || 0), 0) / data.dailyQuizzes.length)
        : '';
      learningMetrics[2].values[subject] = dailyAvg;

      // Fortnight Exam metrics
      // Count: Always show 1 (one fortnight exam count metric)
      learningMetrics[3].values[subject] = totalFortnightExams !== undefined && totalFortnightExams !== null ? totalFortnightExams : '';
      
      // Attempts: Always show 1 (one fortnight exam attempts count metric)
      learningMetrics[4].values[subject] = totalFortnightAttempts !== undefined && totalFortnightAttempts !== null ? totalFortnightAttempts : '';
      
      // Average: Show the score for the specific fortnight exam mapped to this subject
      // Fortnight 1 = Static, Fortnight 2 = Responsive, etc.
      const subjectFortnightNum = Object.keys(fortnightToSubjectMap).find(
        key => fortnightToSubjectMap[key] === subject
      );
      
      if (subjectFortnightNum) {
        // Find the result for this specific fortnight number
        const subjectFortnightResult = allResults.find(result => {
          const examType = (result.exam_type || '').toLowerCase();
          const match = examType.match(/fortnight\s*(\d+)/i);
          return match && parseInt(match[1]) === parseInt(subjectFortnightNum);
        });
        
        if (subjectFortnightResult) {
          // Show the percentage for this specific fortnight exam
          learningMetrics[5].values[subject] = subjectFortnightResult.percentage || '';
        } else {
          // No result for this subject's fortnight exam
          learningMetrics[5].values[subject] = '';
        }
      } else {
        // Subject not in mapping, show empty
        learningMetrics[5].values[subject] = '';
      }

      // Course Exam metrics
      learningMetrics[6].values[subject] = data.courseExams.length || '';
      const courseAvg = data.courseExams.length > 0
        ? Math.round(data.courseExams.reduce((sum, e) => sum + (e.percentage || 0), 0) / data.courseExams.length)
        : '';
      learningMetrics[7].values[subject] = courseAvg;

      // Demo metrics
      learningMetrics[8].values[subject] = data.onlineDemos.length || '';
      const onlineDemoAvg = data.onlineDemos.length > 0
        ? Math.round(data.onlineDemos.reduce((sum, d) => sum + (d.rating || d.score || 0), 0) / data.onlineDemos.length)
        : '';
      learningMetrics[9].values[subject] = onlineDemoAvg;

      learningMetrics[10].values[subject] = data.offlineDemos.length || '';
      const offlineDemoAvg = data.offlineDemos.length > 0
        ? Math.round(data.offlineDemos.reduce((sum, d) => sum + (d.rating || d.score || 0), 0) / data.offlineDemos.length)
        : '';
      learningMetrics[11].values[subject] = offlineDemoAvg;

      // Weeks metrics (placeholder - would need assignment/course data)
      learningMetrics[12].values[subject] = ''; // Expected weeks
      learningMetrics[13].values[subject] = ''; // Taken weeks
    });

    // Get grooming report data (daily observations)
    const observations = await Observation.find({
      trainee: user._id,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ date: 1 });

    // Helper function to determine overall grooming rating for a day
    const getGroomingRating = (grooming) => {
      if (!grooming) return null;
      
      const dressCode = grooming.dressCode || '';
      const neatness = grooming.neatness || '';
      const punctuality = grooming.punctuality || '';
      
      // If any field is "needs_improvement", overall is "Average"
      if (dressCode === 'needs_improvement' || neatness === 'needs_improvement' || punctuality === 'needs_improvement') {
        return 'Average';
      }
      
      // If all are "excellent" or "good", overall is "Good"
      if ((dressCode === 'excellent' || dressCode === 'good') &&
          (neatness === 'excellent' || neatness === 'good') &&
          (punctuality === 'excellent' || punctuality === 'good')) {
        return 'Good';
      }
      
      // If any is "average", overall is "Average"
      if (dressCode === 'average' || neatness === 'average' || punctuality === 'average') {
        return 'Average';
      }
      
      // Default to "Good" if all are good or excellent
      return 'Good';
    };

    // Define months for grouping daily observations
    const months = ['JAN\'25', 'FEB\'25', 'MAR\'25', 'APR\'25', 'MAY\'25', 'JUN\'25', 'JULY\'25', 'AUG\'25', 'SEP\'25', 'OCT\'25', 'NOV\'25', 'DEC\'25'];
    
    // Create daily observations data grouped by month
    const dailyObservationsByMonth = {};
    months.forEach(month => {
      dailyObservationsByMonth[month] = [];
    });

    observations.forEach(obs => {
      const monthKey = moment(obs.date).format('MMM\'YY').toUpperCase();
      const day = moment(obs.date).format('DD');
      const rating = getGroomingRating(obs.grooming);
      
      if (dailyObservationsByMonth.hasOwnProperty(monthKey)) {
        dailyObservationsByMonth[monthKey].push({
          date: moment(obs.date).format('YYYY-MM-DD'),
          day: day,
          rating: rating || 'N/A',
          dressCode: obs.grooming?.dressCode || 'N/A',
          neatness: obs.grooming?.neatness || 'N/A',
          punctuality: obs.grooming?.punctuality || 'N/A'
        });
      }
    });

    // Sort daily observations by date within each month
    Object.keys(dailyObservationsByMonth).forEach(month => {
      dailyObservationsByMonth[month].sort((a, b) => a.date.localeCompare(b.date));
    });

    res.json({
      success: true,
      personalDetails,
      learningReport: {
        subjects,
        metrics: learningMetrics
      },
      groomingReport: {
        months,
        dailyObservations: dailyObservationsByMonth
      }
    });

  } catch (error) {
    console.error('Error fetching candidate detail:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

module.exports = {
  getCandidateDashboardData,
  getCandidateDashboardDetail
};
