const { cloudinary, upload } = require('../config/cloudinary');
const User = require('../models/User');
const UserNew = require('../models/UserNew');
const { createDemoNotification } = require('./notificationController');
const mongoose = require('mongoose');

// Cloudinary configuration is now in config/cloudinary.js

// Upload demo
const uploadDemo = async (req, res) => {
  try {
    const { title, description, courseTag, type, traineeId, traineeName } = req.body;
    
    if (!title || !description || !traineeId) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, and traineeId are required'
      });
    }

    let fileUrl = null;
    if (req.file) {
      // Cloudinary automatically provides the secure URL
      fileUrl = req.file.path; // Cloudinary stores the URL in req.file.path
    }

    // Create demo object
    const demo = {
      id: Date.now().toString(),
      title,
      description,
      courseTag: courseTag || '',
      type: type || 'online',
      fileName: req.file ? req.file.originalname : null,
      fileUrl,
      traineeId,
      traineeName: traineeName || 'Trainee',
      uploadedAt: new Date().toISOString(),
      status: 'under_review',
      rating: 0,
      feedback: '',
      reviewedBy: null,
      reviewedAt: null,
      masterTrainerReview: null,
      masterTrainerReviewedBy: null,
      masterTrainerReviewedAt: null,
      rejectionReason: null
    };

    // Save demo to user's demo_managements_details array
    if (traineeId) {
      try {
        const user = await User.findOne({ author_id: traineeId });
        if (user) {
          user.demo_managements_details.push(demo);
          await user.save();
        } else {
        }
      } catch (dbError) {
        
        // Continue with response even if database save fails
      }
    }

    // Send notification to trainer about demo submission
    if (traineeId && trainerId) {
      try {
        await createDemoNotification(trainerId, traineeName || 'Trainee', type, 'demo_submitted');
      } catch (notificationError) {
        
      }
    }

    res.status(201).json({
      success: true,
      message: 'Demo uploaded successfully',
      demo: demo
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Failed to upload demo',
      error: error.message
    });
  }
};

// Get all demos for a trainee or trainer
const getDemos = async (req, res) => {
  try {
    const { traineeId, trainerId, status, traineeIds } = req.query;
    const requestingUser = req.user; // From auth middleware
    
    // If traineeId is provided, fetch demos for that specific trainee
    if (traineeId) {
      const user = await User.findOne({ author_id: traineeId }).select('demo_managements_details name');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let demos = user.demo_managements_details || [];
      
      // Filter by status if provided
      if (status) {
        const statusArray = status.split(',');
        demos = demos.filter(demo => statusArray.includes(demo.status));
      }
      
      res.status(200).json({
        success: true,
        demos: demos
      });
      return;
    }
    
    // If trainerId is provided or user is a trainer, fetch demos from assigned trainees
    if (trainerId || requestingUser.role === 'trainer') {
      // Use the author_id for database queries, not the MongoDB _id
      const trainerIdToUse = trainerId || requestingUser.author_id;
      
      // Find trainer by author_id
      const trainer = await User.findOne({ author_id: trainerIdToUse }).populate('assignedTrainees', 'author_id name email');
      
      if (!trainer) {
        return res.status(404).json({
          success: false,
          message: 'Trainer not found'
        });
      }
      
      if (!trainer.assignedTrainees || trainer.assignedTrainees.length === 0) {
        return res.json({
          success: true,
          demos: []
        });
      }
      
      const assignedTraineeIds = trainer.assignedTrainees.map(trainee => trainee.author_id);
      // Fetch demos from all assigned trainees
      const trainees = await User.find({ 
        author_id: { $in: assignedTraineeIds } 
      }).select('author_id name email demo_managements_details');
      
      let allDemos = [];
      
      trainees.forEach(trainee => {
        if (trainee.demo_managements_details && trainee.demo_managements_details.length > 0) {
          trainee.demo_managements_details.forEach((demo, index) => {
            });
          
          const traineeDemos = trainee.demo_managements_details.map((demo, index) => ({
            ...demo,
            traineeId: trainee.author_id,
            traineeName: trainee.name,
            traineeEmail: trainee.email,
            demoIndex: index // Add the index for updating
          }));
          allDemos = allDemos.concat(traineeDemos);
        }
      });
      
      // Log demo details for debugging
      allDemos.forEach((demo, index) => {
        });
      
      // Filter by status if provided
      if (status) {
        const statusArray = status.split(',');
        allDemos = allDemos.filter(demo => statusArray.includes(demo.status));
        }
      
      // Filter by specific trainee IDs if provided
      if (traineeIds) {
        const traineeIdArray = traineeIds.split(',');
        allDemos = allDemos.filter(demo => traineeIdArray.includes(demo.traineeId));
        }
      
      res.json({
        success: true,
        demos: allDemos
      });
      return;
    }
    
    // If user is a master trainer and no specific parameters, fetch all demos from all trainees
    if (requestingUser.role === 'master_trainer') {
      // Fetch all trainees with demos
      const trainees = await User.find({ 
        role: 'trainee',
        isActive: true,
        'demo_managements_details.0': { $exists: true }
      }).select('author_id name email demo_managements_details');
      
      let allDemos = [];
      
      trainees.forEach(trainee => {
        if (trainee.demo_managements_details && trainee.demo_managements_details.length > 0) {
          trainee.demo_managements_details.forEach((demo, index) => {
            });
          
          const traineeDemos = trainee.demo_managements_details.map((demo, index) => ({
            ...demo,
            traineeId: trainee.author_id,
            traineeName: trainee.name,
            traineeEmail: trainee.email,
            demoIndex: index // Add the index for updating
          }));
          allDemos = allDemos.concat(traineeDemos);
        }
      });
      
      // Log sample demo data for debugging
      if (allDemos.length > 0) {
        }
      
      // Filter by status if provided
      if (status) {
        const statusArray = status.split(',');
        allDemos = allDemos.filter(demo => statusArray.includes(demo.status));
        }
      
      res.status(200).json({
        success: true,
        demos: allDemos
      });
      return;
    }
    
    // If no specific parameters, return error
    return res.status(400).json({
      success: false,
      message: 'Either traineeId or trainerId is required'
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch demos',
      error: error.message
    });
  }
};

// Get demo by ID
const getDemoById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Mock data for now
    const demo = {
      id: id,
      title: 'Sample Demo',
      description: 'This is a sample demo',
      courseTag: 'React',
      type: 'online',
      fileName: 'sample-demo.mp4',
      fileUrl: '/uploads/demos/sample-demo.mp4',
      traineeId: 'trainee1',
      traineeName: 'Trainee',
      uploadedAt: new Date().toISOString(),
      status: 'under_review',
      rating: 0,
      feedback: '',
      reviewedBy: null,
      reviewedAt: null,
      masterTrainerReview: null,
      masterTrainerReviewedBy: null,
      masterTrainerReviewedAt: null,
      rejectionReason: null
    };

    res.status(200).json({
      success: true,
      demo: demo
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch demo',
      error: error.message
    });
  }
};

// Update demo (for reviews)
const updateDemo = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rating, feedback, reviewedBy, reviewedAt } = req.body;
    
    // Get trainer's name for display (supports author_id or ObjectId)
    let trainerName = 'Unknown Trainer';
    if (reviewedBy) {
      try {
        let trainer = null;
        if (mongoose.Types.ObjectId.isValid(reviewedBy)) {
          trainer = await User.findById(reviewedBy).select('name');
        }
        if (!trainer) {
          trainer = await User.findOne({ author_id: reviewedBy }).select('name');
        }
        if (trainer) {
          trainerName = trainer.name;
        }
      } catch (error) {
        
      }
    }
    
    // Find the demo in the trainee's demo_managements_details array
    // Check both User and UserNew models
    let trainee = await User.findOne({ 
      'demo_managements_details.id': id 
    });
    
    if (!trainee) {
      trainee = await UserNew.findOne({ 
        'demo_managements_details.id': id 
      });
    }
    
    if (!trainee) {
      return res.status(404).json({
        success: false,
        message: 'Demo not found'
      });
    }
    
    // Find the specific demo in the array
    const demoIndex = trainee.demo_managements_details.findIndex(demo => demo.id === id);
    
    if (demoIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Demo not found in trainee records'
      });
    }
    
    // Update the demo based on the action
    if (action === 'approve') {
      // Keep status as 'under_review' until master trainer approves
      trainee.demo_managements_details[demoIndex].status = 'under_review';
      trainee.demo_managements_details[demoIndex].rating = rating;
      trainee.demo_managements_details[demoIndex].feedback = feedback;
      trainee.demo_managements_details[demoIndex].reviewedBy = reviewedBy;
      trainee.demo_managements_details[demoIndex].reviewedByName = trainerName;
      trainee.demo_managements_details[demoIndex].reviewedAt = reviewedAt;
      trainee.demo_managements_details[demoIndex].trainerStatus = 'approved';
      trainee.demo_managements_details[demoIndex].masterTrainerStatus = 'pending';
    } else if (action === 'reject') {
      trainee.demo_managements_details[demoIndex].status = 'trainer_rejected';
      trainee.demo_managements_details[demoIndex].rating = 0;
      trainee.demo_managements_details[demoIndex].feedback = '';
      trainee.demo_managements_details[demoIndex].rejectionReason = feedback;
      trainee.demo_managements_details[demoIndex].reviewedBy = reviewedBy;
      trainee.demo_managements_details[demoIndex].reviewedByName = trainerName;
      trainee.demo_managements_details[demoIndex].reviewedAt = reviewedAt;
      trainee.demo_managements_details[demoIndex].trainerStatus = 'rejected';
      trainee.demo_managements_details[demoIndex].masterTrainerStatus = null;
    }
    
    // Mark the field as modified to ensure Mongoose saves it
    trainee.markModified('demo_managements_details');
    
    // Save the updated trainee document
    await trainee.save();
    
    res.status(200).json({
      success: true,
      message: `Demo ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      demo: trainee.demo_managements_details[demoIndex]
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Failed to update demo',
      error: error.message
    });
  }
};

// Delete demo
const deleteDemo = async (req, res) => {
  try {
    const { id } = req.params;
    const { traineeId } = req.query;
    
    if (!traineeId) {
      return res.status(400).json({
        success: false,
        message: 'Trainee ID is required'
      });
    }

    // Find user and remove demo from their demo_managements_details array
    const user = await User.findOne({ author_id: traineeId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove demo from the array
    user.demo_managements_details = user.demo_managements_details.filter(demo => demo.id !== id);
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Demo deleted successfully'
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete demo',
      error: error.message
    });
  }
};

// Master trainer final review
const masterReviewDemo = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rating, feedback, reviewedBy, reviewedAt } = req.body;
    
    // Find the demo in the trainee's demo_managements_details array
    const trainee = await User.findOne({ 
      'demo_managements_details.id': id 
    });
    
    if (!trainee) {
      return res.status(404).json({
        success: false,
        message: 'Demo not found'
      });
    }
    
    // Find the specific demo in the array
    const demoIndex = trainee.demo_managements_details.findIndex(demo => demo.id === id);
    
    if (demoIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Demo not found in trainee records'
      });
    }
    
    // Update the demo based on the action
    if (action === 'approve') {
      // Final approval - change main status to approved
      trainee.demo_managements_details[demoIndex].status = 'approved';
      trainee.demo_managements_details[demoIndex].masterTrainerReview = feedback;
      trainee.demo_managements_details[demoIndex].masterTrainerReviewedBy = reviewedBy;
      trainee.demo_managements_details[demoIndex].masterTrainerReviewedAt = reviewedAt;
      trainee.demo_managements_details[demoIndex].masterTrainerStatus = 'approved';
    } else if (action === 'reject') {
      // Final rejection
      trainee.demo_managements_details[demoIndex].status = 'master_trainer_rejected';
      trainee.demo_managements_details[demoIndex].masterTrainerReview = feedback;
      trainee.demo_managements_details[demoIndex].masterTrainerReviewedBy = reviewedBy;
      trainee.demo_managements_details[demoIndex].masterTrainerReviewedAt = reviewedAt;
      trainee.demo_managements_details[demoIndex].masterTrainerStatus = 'rejected';
    }
    
    // Mark the field as modified to ensure Mongoose saves it
    trainee.markModified('demo_managements_details');
    
    // Save the updated trainee document
    await trainee.save();
    
    res.status(200).json({
      success: true,
      message: `Demo ${action === 'approve' ? 'approved' : 'rejected'} by master trainer successfully`,
      demo: trainee.demo_managements_details[demoIndex]
    });
  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Failed to process master trainer review',
      error: error.message
    });
  }
};

// Create offline demo
const createOfflineDemo = async (req, res) => {
  try {
    const { 
      traineeId, 
      feedback,
      evaluationData
    } = req.body;

    if (!traineeId || !feedback) {
      return res.status(400).json({
        success: false,
        message: 'Trainee ID and feedback are required'
      });
    }

    // Find the trainee in both User and UserNew models
    let trainee = await User.findOne({ author_id: traineeId });
    if (!trainee) {
      trainee = await UserNew.findOne({ author_id: traineeId });
    }

    if (!trainee) {
      return res.status(404).json({
        success: false,
        message: 'Trainee not found'
      });
    }

    // Create offline demo data
    const offlineDemoData = {
      id: Date.now().toString(),
      feedback: feedback,
      evaluationData: evaluationData || {},
      createdBy: req.user?.author_id || req.user?.id,
      status: 'pending_approval',
      type: 'offline_demo',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to trainee's demo_managements_details array
    const updateResult = await User.findOneAndUpdate(
      { author_id: traineeId },
      { 
        $push: { 
          demo_managements_details: offlineDemoData 
        },
        $set: { updatedAt: new Date() }
      },
      { new: true }
    );

    if (!updateResult) {
      // Try UserNew model if not found in User
      await UserNew.findOneAndUpdate(
        { author_id: traineeId },
        { 
          $push: { 
            demo_managements_details: offlineDemoData 
          },
          $set: { updatedAt: new Date() }
        },
        { new: true }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Offline demo created successfully. Awaiting master trainer approval.',
      data: {
        traineeId,
        feedback,
        status: 'pending_approval'
      }
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Server error while creating offline demo',
      error: error.message
    });
  }
};

// Update offline demo (for master trainer approval)
const updateOfflineDemo = async (req, res) => {
  try {
    const { traineeId, demoIndex } = req.params;
    const { action, reviewedBy, reviewedAt } = req.body;

    if (!action || !traineeId || demoIndex === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Trainee ID, demo index, and action are required'
      });
    }

    // Find the trainee in both User and UserNew models
    let trainee = await User.findOne({ author_id: traineeId });
    if (!trainee) {
      trainee = await UserNew.findOne({ author_id: traineeId });
    }

    if (!trainee) {
      return res.status(404).json({
        success: false,
        message: 'Trainee not found'
      });
    }

    const demoIndexNum = parseInt(demoIndex);
    if (!trainee.demo_managements_details || demoIndexNum >= trainee.demo_managements_details.length) {
      return res.status(404).json({
        success: false,
        message: 'Demo not found at the specified index'
      });
    }

    // Update the specific demo object in place to preserve existing fields
    const traineeDoc = await User.findOne({ author_id: traineeId }) || await UserNew.findOne({ author_id: traineeId });
    if (!traineeDoc) {
      return res.status(404).json({ success: false, message: 'Trainee not found' });
    }

    const demoObj = traineeDoc.demo_managements_details[demoIndexNum];
    if (!demoObj) {
      return res.status(404).json({ success: false, message: 'Demo not found at the specified index' });
    }

    // Ensure type remains 'offline_demo' and keep other metadata
    demoObj.type = demoObj.type || 'offline_demo';
    demoObj.status = action === 'approve' ? 'approved' : 'rejected';
    demoObj.masterTrainerReviewedBy = reviewedBy;
    demoObj.masterTrainerReviewedAt = reviewedAt || new Date();
    demoObj.updatedAt = new Date();

    traineeDoc.markModified('demo_managements_details');
    await traineeDoc.save();

    res.status(200).json({
      success: true,
      message: `Offline demo ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: {
        traineeId,
        demoIndex: demoIndexNum,
        action,
        status: action === 'approve' ? 'approved' : 'rejected'
      }
    });

  } catch (error) {
    
    res.status(500).json({
      success: false,
      message: 'Server error while updating offline demo',
      error: error.message
    });
  }
};

module.exports = {
  upload,
  uploadDemo,
  getDemos,
  getDemoById,
  updateDemo,
  deleteDemo,
  masterReviewDemo,
  createOfflineDemo,
  updateOfflineDemo
};
