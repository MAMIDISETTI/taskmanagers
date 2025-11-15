const TraineeDayPlan = require("../models/TraineeDayPlan");
const User = require("../models/User");
const Joiner = require("../models/Joiner");
const Notification = require("../models/Notification");

// @desc    Create a new trainee day plan submission
// @route   POST /api/trainee-dayplans
// @access  Private (Trainee)
const createTraineeDayPlan = async (req, res) => {
  try {
    // Check if this is a trainer creating day plans for trainees
    const { traineeId, createdBy } = req.body;
    const actualTraineeId = traineeId || req.user.id;
    
    // If traineeId is provided, this means a trainer is creating the day plan
    // Otherwise, it's a trainee creating their own day plan
    if (traineeId && req.user.role !== 'trainer') {
      return res.status(403).json({ 
        message: "Only trainers can create day plans for other trainees" 
      });
    }

    const { title, date, tasks, topics, checkboxes, status = "submitted" } = req.body;
    
    // Check if trainee already has a day plan for this date
    const existingPlan = await TraineeDayPlan.findOne({
      trainee: actualTraineeId,
      date: new Date(date)
    });

    if (existingPlan) {
      return res.status(400).json({ 
        message: "Day plan already exists for this date. Please update the existing plan instead." 
      });
    }

    // Create the trainee day plan
    const dayPlanData = {
      trainee: actualTraineeId,
      title: title || "", // Include title
      date: new Date(date),
      tasks: (tasks || []).map(task => ({
        ...task,
        id: task.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` // Ensure task has ID
      })),
      topics: topics || [], // Include topics
      checkboxes: checkboxes || {},
      status: status === "submitted" ? "in_progress" : status,
      submittedAt: status === "submitted" ? new Date() : null,
      createdBy: createdBy || "trainee" // Track who created the plan
    };
    
    let traineeDayPlan;
    try {
      traineeDayPlan = await TraineeDayPlan.create(dayPlanData);
      } catch (createError) {
      console.error("Error creating day plan:", createError);
      console.error("Create error details:", createError.message);
      return res.status(400).json({ 
        message: "Failed to create day plan", 
        error: createError.message 
      });
    }

    // Only send notification if status is submitted (not draft)
    if (status === "submitted") {
      try {
        // Get trainee's assigned trainer
        const trainee = await User.findById(actualTraineeId).select('assignedTrainer name');
        if (trainee && trainee.assignedTrainer) {
          // Send notification to trainer
          await Notification.create({
            recipient: trainee.assignedTrainer,
            sender: createdBy === "trainer" ? req.user.id : actualTraineeId,
            title: createdBy === "trainer" ? "Day Plan Assigned" : "New Day Plan Submission",
            message: createdBy === "trainer" 
              ? `A day plan has been assigned to you for ${trainee.name} on ${new Date(date).toLocaleDateString()}`
              : `${trainee.name} has submitted a day plan for ${new Date(date).toLocaleDateString()}`,
            type: "trainee_day_plan",
            relatedEntity: {
              type: "trainee_day_plan",
              id: traineeDayPlan._id
            },
            priority: "medium"
          });
        } else {
          }
      } catch (notificationError) {
        console.error("Error creating notification:", notificationError);
        // Don't fail the entire request if notification fails
      }
    }

    res.status(201).json({
      message: status === "draft" ? "Day plan saved as draft" : "Day plan submitted successfully",
      dayPlan: traineeDayPlan
    });

  } catch (error) {
    console.error("Error creating trainee day plan:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Get trainee's day plan submissions
// @route   GET /api/trainee-dayplans
// @access  Private (Trainee, Trainer)
const getTraineeDayPlans = async (req, res) => {
  try {
    const { status, startDate, endDate, page = 1, limit = 20, traineeId, role, stats, date, details } = req.query;
    
    let query = {};
    
    // Handle master trainer requests
    if (role === 'master_trainer' || req.user.role === 'master_trainer') {
      if (stats === 'true') {
        // Return statistics for master trainer
        const totalPlans = await TraineeDayPlan.countDocuments({});
        // 'published' means plans approved by trainers (status: 'approved')
        const publishedPlans = await TraineeDayPlan.countDocuments({ status: 'approved' });
        // 'completed' means plans with EOD approved (status: 'completed' AND eodUpdate.status: 'approved')
        const completedPlans = await TraineeDayPlan.countDocuments({ 
          status: 'completed',
          'eodUpdate.status': 'approved'
        });
        // 'draft' means plans that are draft or in_progress (not yet approved)
        const draftPlans = await TraineeDayPlan.countDocuments({ 
          $or: [
            { status: 'draft' },
            { status: 'in_progress' }
          ]
        });

        return res.json({
          success: true,
          totalPlans,
          published: publishedPlans,
          completed: completedPlans,
          draft: draftPlans
        });
      }

      if (details === 'true' && date) {
        // Return day plan details for specific date
        const dateStr = date.toString();
        
        // Try a simpler approach - get all day plans and filter by date string
        const allDayPlans = await TraineeDayPlan.find({})
          .populate('trainee', 'name email employeeId department');
        
        // Filter by date string matching
        const dayPlans = allDayPlans.filter(plan => {
          const planDateString = plan.date.toISOString().split('T')[0];
          return planDateString === dateStr;
        });

        const formattedPlans = dayPlans.map(plan => ({
          id: plan._id,
          traineeName: plan.trainee?.name || 'Unknown',
          traineeId: plan.trainee?.employeeId || 'N/A',
          department: plan.trainee?.department || 'N/A',
          date: plan.date.toISOString().split('T')[0],
          status: plan.status,
          tasks: plan.tasks || [],
          submittedAt: plan.submittedAt || plan.createdAt,
          approvedAt: plan.approvedAt,
          completedAt: plan.status === 'completed' ? plan.updatedAt : null
        }));

        return res.json({
          success: true,
          dayPlans: formattedPlans
        });
      }

      // Return all trainee day plans for master trainer
      const dayPlans = await TraineeDayPlan.find({})
        .populate({
          path: 'trainee',
          select: 'name email employeeId department',
          model: 'User'
        })
        .sort({ date: -1, submittedAt: -1 });

      // Ensure trainee data is properly included and get correct employee ID from Joiner if needed
      const formattedDayPlans = await Promise.all(dayPlans.map(async (plan) => {
        const planObj = plan.toObject ? plan.toObject() : plan;
        let trainee = planObj.trainee || null;
        
        // If trainee exists but employeeId is in wrong format (starts with EMP_), try to get from Joiner
        if (trainee && trainee.employeeId && trainee.employeeId.startsWith('EMP_')) {
          try {
            const joiner = await Joiner.findOne({
              $or: [
                { candidate_personal_mail_id: trainee.email },
                { email: trainee.email },
                { name: trainee.name }
              ]
            }).select('employeeId employee_id');
            
            if (joiner && (joiner.employeeId || joiner.employee_id)) {
              // Use the employee ID from Joiner if it exists and is not in EMP_ format
              const joinerEmpId = joiner.employeeId || joiner.employee_id;
              if (joinerEmpId && !joinerEmpId.startsWith('EMP_')) {
                trainee = {
                  ...trainee,
                  employeeId: joinerEmpId
                };
              }
            }
          } catch (err) {
            console.error('Error fetching joiner for employee ID:', err);
          }
        }
        
        return {
          ...planObj,
          trainee: trainee
        };
      }));

      return res.json({
        success: true,
        dayPlans: formattedDayPlans
      });
    }
    
    // If user is a trainee, only show their own day plans
    if (req.user.role === 'trainee') {
      query.trainee = req.user.id;
    } 
    // If user is a trainer, show day plans of their assigned trainees
    else if (req.user.role === 'trainer') {
      // Get trainer's assigned trainees
      const trainer = await User.findById(req.user.id).populate('assignedTrainees', '_id');
      if (trainer && trainer.assignedTrainees && trainer.assignedTrainees.length > 0) {
        const traineeIds = trainer.assignedTrainees.map(t => t._id);
        query.trainee = { $in: traineeIds };
      } else {
        // If trainer has no assigned trainees, return empty result
        return res.json({ 
          success: true, 
          dayPlans: [], 
          total: 0, 
          page: parseInt(page), 
          totalPages: 0 
        });
      }
    }
    // If specific traineeId is provided (for trainer viewing specific trainee)
    if (traineeId) {
      query.trainee = traineeId;
    }

    if (status) {
      query.status = status;
    }

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const dayPlans = await TraineeDayPlan.find(query)
      .populate('trainee', 'name email employeeId')
      .sort({ date: -1, submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Debug: Log checkbox data for each plan
    dayPlans.forEach((plan, index) => {
      });
    const total = await TraineeDayPlan.countDocuments(query);

    res.json({
      success: true,
      dayPlans,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error("Error fetching trainee day plans:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Get a specific trainee day plan
// @route   GET /api/trainee-dayplans/:id
// @access  Private (Trainee, Trainer)
const getTraineeDayPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const dayPlan = await TraineeDayPlan.findById(id)
      .populate('trainee', 'name email employeeId')
      .populate('reviewedBy', 'name email')
      .populate('approvedBy', 'name email');

    if (!dayPlan) {
      return res.status(404).json({ message: "Day plan not found" });
    }

    // Check access permissions
    if (userRole === "trainee") {
      if (dayPlan.trainee._id.toString() !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
    } else if (userRole === "trainer") {
      // Check if this trainer is assigned to the trainee
      const trainee = await User.findById(dayPlan.trainee._id).select('assignedTrainer');
      if (!trainee || trainee.assignedTrainer.toString() !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
    } else if (userRole === "master_trainer") {
      // Master trainers can view any trainee day plan
      // No additional checks
    }

    res.json(dayPlan);

  } catch (error) {
    console.error("Error fetching trainee day plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Update trainee day plan (only if draft)
// @route   PUT /api/trainee-dayplans/:id
// @access  Private (Trainee)
const updateTraineeDayPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const traineeId = req.user.id;
    const { tasks, checkboxes } = req.body;

    const dayPlan = await TraineeDayPlan.findById(id);
    if (!dayPlan) {
      return res.status(404).json({ message: "Day plan not found" });
    }

    if (dayPlan.trainee.toString() !== traineeId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (dayPlan.status !== "draft" && dayPlan.status !== "in_progress") {
      return res.status(400).json({ 
        message: "Cannot update day plan. Only draft or in_progress day plans can be updated." 
      });
    }

    const updatedDayPlan = await TraineeDayPlan.findByIdAndUpdate(
      id,
      { 
        tasks: tasks || dayPlan.tasks,
        checkboxes: checkboxes || dayPlan.checkboxes
      },
      { new: true, runValidators: true }
    );

    res.json({
      message: "Day plan updated successfully",
      dayPlan: updatedDayPlan
    });

  } catch (error) {
    console.error("Error updating trainee day plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Submit trainee day plan (draft to submitted)
// @route   PUT /api/trainee-dayplans/:id/submit
// @access  Private (Trainee)
const submitTraineeDayPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const traineeId = req.user.id;

    const dayPlan = await TraineeDayPlan.findById(id);
    if (!dayPlan) {
      return res.status(404).json({ message: "Day plan not found" });
    }

    if (dayPlan.trainee.toString() !== traineeId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (dayPlan.status !== "draft") {
      return res.status(400).json({ 
        message: "Day plan is already submitted" 
      });
    }

    // Validate required fields
    const hasEmptyTasks = dayPlan.tasks.some(task => 
      !task.title.trim() || !task.timeAllocation || !task.description.trim()
    );

    if (hasEmptyTasks) {
      return res.status(400).json({ 
        message: "Please fill in all task details before submitting" 
      });
    }

    dayPlan.status = "submitted";
    dayPlan.submittedAt = new Date();
    await dayPlan.save();

    // Get trainee's assigned trainer
    const trainee = await User.findById(traineeId).select('assignedTrainer name');
    if (trainee && trainee.assignedTrainer) {
      // Send notification to trainer
      await Notification.create({
        recipient: trainee.assignedTrainer,
        sender: traineeId,
        title: "Day Plan Submitted",
        message: `${trainee.name} has submitted a day plan for ${dayPlan.date.toLocaleDateString()}`,
        type: "trainee_day_plan",
        relatedEntity: {
          type: "trainee_day_plan",
          id: dayPlan._id
        },
        priority: "medium"
      });
    }

    res.json({
      message: "Day plan submitted successfully",
      dayPlan
    });

  } catch (error) {
    console.error("Error submitting trainee day plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Review trainee day plan (for trainers)
// @route   PUT /api/trainee-dayplans/:id/review
// @access  Private (Trainer)
const reviewTraineeDayPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const trainerId = req.user.id;
    const { status, reviewComments } = req.body;

    const dayPlan = await TraineeDayPlan.findById(id).populate('trainee', 'assignedTrainer');
    if (!dayPlan) {
      return res.status(404).json({ message: "Day plan not found" });
    }

    // Check if this trainer is assigned to the trainee
    if (dayPlan.trainee.assignedTrainer?.toString() !== trainerId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Must be 'approved' or 'rejected'" 
      });
    }

    if (dayPlan.status !== "in_progress") {
      return res.status(400).json({ 
        message: "Only day plans with 'in_progress' status can be reviewed" 
      });
    }

    // When trainer approves initial day plan, set status to "approved" (not "completed")
    // "completed" status is only for after EOD approval
    dayPlan.status = status === "approved" ? "approved" : "rejected";
    dayPlan.reviewedBy = trainerId;
    dayPlan.reviewedAt = new Date();
    dayPlan.reviewComments = reviewComments || "";

    if (status === "approved") {
      dayPlan.approvedBy = trainerId;
      dayPlan.approvedAt = new Date();
    }

    await dayPlan.save();

    // Send notification to trainee (match Notification schema)
    try {
      await Notification.createNotification({
        recipientId: dayPlan.trainee._id.toString(),
        recipientRole: 'trainee',
        type: 'status_update',
        title: `Day Plan ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: `Your day plan for ${dayPlan.date.toLocaleDateString()} has been ${status}`,
        data: {
          entityType: 'trainee_day_plan',
          id: dayPlan._id.toString(),
          status
        },
        priority: 'medium',
        relatedEntityId: dayPlan._id.toString(),
        relatedEntityType: 'user'
      });
    } catch (notifyError) {
      // Do not fail the review due to notification issues
      console.error('Notification error (reviewTraineeDayPlan):', notifyError?.message);
    }

    res.json({
      message: `Day plan ${status} successfully`,
      dayPlan
    });

  } catch (error) {
    console.error("=== REVIEW TRAINEE DAY PLAN ERROR ===");
    console.error("Error reviewing trainee day plan:", error);
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Delete trainee day plan (only if draft)
// @route   DELETE /api/trainee-dayplans/:id
// @access  Private (Trainee)
const deleteTraineeDayPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const traineeId = req.user.id;

    const dayPlan = await TraineeDayPlan.findById(id);
    if (!dayPlan) {
      return res.status(404).json({ message: "Day plan not found" });
    }

    if (dayPlan.trainee.toString() !== traineeId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (dayPlan.status !== "draft") {
      return res.status(400).json({ 
        message: "Cannot delete submitted day plan" 
      });
    }

    await TraineeDayPlan.findByIdAndDelete(id);

    res.json({ message: "Day plan deleted successfully" });

  } catch (error) {
    console.error("Error deleting trainee day plan:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Test endpoint to check day plans
// @route   GET /api/trainee-dayplans/test
// @access  Private (Trainee)
const testDayPlans = async (req, res) => {
  try {
    const traineeId = req.user.id;
    const dayPlans = await TraineeDayPlan.find({ trainee: traineeId }).sort({ date: -1 }).limit(5);
    res.json({
      message: "Test successful",
      count: dayPlans.length,
      dayPlans: dayPlans
    });
  } catch (error) {
    console.error("Test error:", error);
    res.status(500).json({ message: "Test failed", error: error.message });
  }
};

// @desc    Submit EOD (End of Day) update for tasks
// @route   POST /api/trainee-dayplans/eod-update
// @access  Private (Trainee)
const submitEodUpdate = async (req, res) => {
  try {
    const traineeId = req.user.id;
    const { date, tasks, overallRemarks, checkboxes: checkboxUpdates } = req.body;
    
    // Find today's day plan
    const dayPlan = await TraineeDayPlan.findOne({
      trainee: traineeId,
      date: new Date(date)
    });

    if (!dayPlan) {
      return res.status(404).json({ 
        message: "No day plan found for today. Please submit a day plan first." 
      });
    }

    // Check if day plan is approved (trainee can only submit EOD after trainer approves)
    if (dayPlan.status !== 'approved') {
      return res.status(400).json({ 
        message: "Day plan must be approved by trainer before submitting EOD update." 
      });
    }

    // Update task statuses and remarks using direct assignment
    tasks.forEach(taskUpdate => {
      const taskIndex = taskUpdate.taskIndex;
      if (dayPlan.tasks[taskIndex]) {
        dayPlan.tasks[taskIndex].status = taskUpdate.status;
        dayPlan.tasks[taskIndex].remarks = taskUpdate.remarks || '';
        dayPlan.tasks[taskIndex].updatedAt = new Date();
        }
    });

    // Apply checkbox completion updates if provided
    if (Array.isArray(checkboxUpdates) && checkboxUpdates.length > 0) {
      try {
        checkboxUpdates.forEach(update => {
          const taskId = update.taskId;
          const checkboxId = update.checkboxId;
          if (!taskId || !checkboxId) return;
          if (!dayPlan.checkboxes) return;
          const possibleKeys = [String(taskId), taskId];
          let taskBoxGroup = null;
          for (const key of possibleKeys) {
            if (dayPlan.checkboxes[key]) {
              taskBoxGroup = dayPlan.checkboxes[key];
              break;
            }
          }
          if (!taskBoxGroup) return;
          // taskBoxGroup may be array or object
          if (Array.isArray(taskBoxGroup)) {
            const idx = taskBoxGroup.findIndex(c => String(c.id) === String(checkboxId));
            if (idx >= 0) {
              taskBoxGroup[idx].checked = !!update.checked;
              taskBoxGroup[idx].updatedAt = new Date();
            }
          } else if (typeof taskBoxGroup === 'object') {
            const cb = taskBoxGroup[checkboxId] || taskBoxGroup[String(checkboxId)];
            if (cb) {
              cb.checked = !!update.checked;
              cb.updatedAt = new Date();
              taskBoxGroup[checkboxId] = cb;
            }
          }
        });
      } catch (cbErr) {
      
      }
    }

    // Set EOD update details and change status to under_review
    dayPlan.eodUpdate = {
      submittedAt: new Date(),
      overallRemarks: overallRemarks || '',
      status: 'submitted'
    };
    
    // Change day plan status to pending
    dayPlan.status = 'pending';
    
    const savedDayPlan = await dayPlan.save();
    // Send notification to trainer
    try {
      const trainee = await User.findById(traineeId).select('assignedTrainer name');
      if (trainee && trainee.assignedTrainer) {
        await Notification.create({
          recipient: trainee.assignedTrainer,
          sender: traineeId,
          title: "EOD Update Received",
          message: `${trainee.name} has submitted their end-of-day update for ${new Date(date).toLocaleDateString()}`,
          type: "trainee_day_plan",
          relatedEntity: {
            type: "trainee_day_plan",
            id: dayPlan._id
          },
          priority: "medium"
        });
      }
    } catch (notificationError) {
      console.error("Error creating EOD notification:", notificationError);
      // Don't fail the request if notification fails
    }

    // Fetch the updated day plan to verify data was saved
    const updatedDayPlan = await TraineeDayPlan.findById(dayPlan._id);
    res.json({
      message: "EOD update submitted successfully",
      dayPlan: updatedDayPlan
    });

  } catch (error) {
    console.error("Error submitting EOD update:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Review EOD update (for trainers)
// @route   PUT /api/trainee-dayplans/:id/eod-review
// @access  Private (Trainer)
const reviewEodUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const trainerId = req.user.id;
    const { status, reviewComments } = req.body;

    const dayPlan = await TraineeDayPlan.findById(id).populate('trainee', 'assignedTrainer name');
    if (!dayPlan) {
      return res.status(404).json({ message: "Day plan not found" });
    }

    // Check if this trainer is assigned to the trainee
    if (dayPlan.trainee.assignedTrainer?.toString() !== trainerId) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if day plan is pending
    if (dayPlan.status !== 'pending') {
      return res.status(400).json({ 
        message: "Only day plans with pending EOD updates can be reviewed" 
      });
    }

    // Validate status
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Must be 'approved' or 'rejected'" 
      });
    }

    // Update EOD review details
    dayPlan.eodUpdate.reviewedAt = new Date();
    dayPlan.eodUpdate.reviewedBy = trainerId;
    dayPlan.eodUpdate.reviewComments = reviewComments || '';
    dayPlan.eodUpdate.status = status;

    // Update day plan status based on review
    if (status === 'approved') {
      dayPlan.status = 'completed';
    } else {
      dayPlan.status = 'rejected';
    }

    await dayPlan.save();

    // Send notification to trainee (match Notification schema)
    try {
      await Notification.createNotification({
        recipientId: dayPlan.trainee._id.toString(),
        recipientRole: 'trainee',
        type: 'status_update',
        title: `EOD Update ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: `Your end-of-day update for ${dayPlan.date.toLocaleDateString()} has been ${status}`,
        data: {
          entityType: 'trainee_day_plan',
          id: dayPlan._id.toString(),
          status
        },
        priority: 'medium',
        relatedEntityId: dayPlan._id.toString(),
        relatedEntityType: 'user'
      });
    } catch (notifyErr) {
      console.error('Notification error (reviewEodUpdate):', notifyErr?.message);
    }

    res.json({
      message: `EOD update ${status} successfully`,
      dayPlan
    });

  } catch (error) {
    console.error("=== EOD REVIEW ERROR ===");
    console.error("Error reviewing EOD update:", error);
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  createTraineeDayPlan,
  getTraineeDayPlans,
  getTraineeDayPlan,
  updateTraineeDayPlan,
  submitTraineeDayPlan,
  reviewTraineeDayPlan,
  deleteTraineeDayPlan,
  submitEodUpdate,
  reviewEodUpdate,
  testDayPlans
};
