const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const UserNew = require("../models/UserNew");
const Joiner = require("../models/Joiner");
const crypto = require("crypto");

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// Register User
const registerUser = async (req, res) => {
  try {
    const {
      name, email, password, profileImageUrl, adminInviteToken
    } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ 
        message: "Missing required fields: name, email, and password are required" 
      });
    }

    // Check if user already exists
    const userExists = await UserNew.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Determine user role based on invite token
    let role = "trainee"; // Default role
    const cleanedToken = (adminInviteToken || "").toString().trim();
    
    if (cleanedToken) {
      // Check if admin token matches
      if (process.env.ADMIN_INVITE_TOKEN && cleanedToken === process.env.ADMIN_INVITE_TOKEN.trim()) {
        role = "admin";
        } else if (process.env.MASTER_TRAINER_INVITE_TOKEN && cleanedToken === process.env.MASTER_TRAINER_INVITE_TOKEN.trim()) {
        role = "master_trainer";
        } else if (process.env.TRAINER_INVITE_TOKEN && cleanedToken === process.env.TRAINER_INVITE_TOKEN.trim()) {
        role = "trainer";
        } else if (process.env.TRAINEE_INVITE_TOKEN && cleanedToken === process.env.TRAINEE_INVITE_TOKEN.trim()) {
        role = "trainee";
        } else if (process.env.BOA_INVITE_TOKEN && cleanedToken === process.env.BOA_INVITE_TOKEN.trim()) {
        role = "boa";
        } else {
        return res.status(400).json({ 
          message: "Invalid invite code. Please check your invite code and try again." 
        });
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user with minimal data
    const user = await UserNew.create({
      name,
      email,
      password: hashedPassword,
      profileImageUrl,
      role,
      accountCreatedAt: new Date(),
      createdBy: req.user ? req.user._id : null
    });

    // For trainees, create a joiner record
    if (role === "trainee") {
      const joiner = await Joiner.create({
        name: name,
        candidate_name: name,
        email: email,
        candidate_personal_mail_id: email,
        phone: null, // Will be updated later
        phone_number: null,
        department: 'OTHERS', // Default department
        top_department_name_as_per_darwinbox: null,
        department_name_as_per_darwinbox: null,
        role: role,
        role_assign: 'OTHER',
        qualification: null,
        employeeId: null,
        genre: null,
        joiningDate: new Date(),
        date_of_joining: new Date(),
        joining_status: 'active',
        author_id: crypto.randomUUID(),
        status: 'active',
        accountCreated: true,
        accountCreatedAt: new Date(),
        createdBy: req.user ? req.user._id : null,
        userId: user._id,
        onboardingChecklist: {
          welcomeEmailSent: false,
          credentialsGenerated: false,
          accountActivated: true,
          trainingAssigned: false,
          documentsSubmitted: false
        }
      });

      // Update user with joiner reference
      user.joinerId = joiner._id;
      await user.save();
    }

    // Return user data with JWT
    const responseData = {
      _id: user._id,
      author_id: user.author_id,
      name: user.name,
      email: user.email,
      role: user.role,
      profileImageUrl: user.profileImageUrl,
      token: generateToken(user._id),
    };

    res.status(201).json(responseData);
  } catch (error) {
    console.error("=== REGISTRATION ERROR ===");
    console.error("Error details:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      message: "Server error during registration",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Login User
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists in UserNew model first
    let user = await UserNew.findOne({ email });
    let userModel = 'UserNew';
    
    // If not found in UserNew, check old User model
    if (!user) {
      const User = require('../models/User');
      user = await User.findOne({ email });
      userModel = 'User';
    }
    
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check if user account is active
    if (user.isActive === false) {
      return res.status(403).json({ 
        message: "Account is deactivated. Please contact administrator for assistance." 
      });
    }

    // Get full user data with joiner information (only for UserNew)
    let fullUserData = null;
    if (userModel === 'UserNew' && user.getFullData) {
      fullUserData = await user.getFullData();
    }

    // Return user data with JWT
    const responseData = {
      _id: user._id,
      author_id: user.author_id || user._id.toString(), // Fallback for old User model
      name: user.name,
      email: user.email,
      role: user.role,
      profileImageUrl: user.profileImageUrl,
      joinerData: fullUserData?.joinerData || null,
      passwordChanged: user.passwordChanged !== undefined ? user.passwordChanged : false,
      tempPassword: user.tempPassword || null,
      token: generateToken(user._id),
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
};

// Get User Profile
const getUserProfile = async (req, res) => {
  try {
    // Try UserNew model first
    let user = await UserNew.findById(req.user._id);
    let userModel = 'UserNew';
    
    // If not found, try old User model
    if (!user) {
      const User = require('../models/User');
      user = await User.findById(req.user._id);
      userModel = 'User';
    }
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get joiner data if available
    let joiner = null;
    if (userModel === 'UserNew') {
      try {
        // First try to find by joinerId
        if (user.joinerId) {
          joiner = await Joiner.findById(user.joinerId);
        }
        
        // If not found by joinerId, try to find by email or userId
        if (!joiner && user.email) {
          joiner = await Joiner.findOne({
            $or: [
              { email: user.email },
              { candidate_personal_mail_id: user.email },
              { userId: user._id }
            ]
          });
        }
        
      } catch (err) {
        console.error('Error fetching joiner:', err);
      }
    }

    // Safe field access with fallbacks - include all profile fields
    const responseData = {
      _id: user._id,
      author_id: user.author_id || user._id.toString(),
      name: user.name || joiner?.candidate_name || joiner?.name || 'Unknown',
      email: user.email || joiner?.candidate_personal_mail_id || joiner?.email || '',
      role: user.role || 'trainee',
      profileImageUrl: user.profileImageUrl || null,
      joinerData: user.joinerData || null,
      isActive: user.isActive !== undefined ? user.isActive : true,
      lastClockIn: user.lastClockIn || null,
      lastClockOut: user.lastClockOut || null,
      accountCreatedAt: user.accountCreatedAt || user.createdAt || new Date(),
      createdAt: user.createdAt || new Date(),
      passwordChanged: user.passwordChanged !== undefined ? user.passwordChanged : false,
      tempPassword: user.tempPassword || null,
      // Profile fields
      phone: user.phone || user.phone_number || joiner?.phone || joiner?.phone_number || '',
      phone_number: user.phone_number || user.phone || joiner?.phone_number || joiner?.phone || '',
      department: user.department || joiner?.department || '',
      employeeId: joiner?.employeeId || user.employeeId || '', // Prioritize joiner's employeeId
      qualification: user.qualification || joiner?.qualification || '',
      specialization: user.specialization || joiner?.specialization || '',
      state: user.state || joiner?.state || '',
      genre: user.genre || joiner?.genre || '',
      joiningDate: user.joiningDate || user.date_of_joining || joiner?.joiningDate || joiner?.date_of_joining || null,
      date_of_joining: user.date_of_joining || user.joiningDate || joiner?.date_of_joining || joiner?.joiningDate || null,
      haveMTechPC: user.haveMTechPC || joiner?.haveMTechPC || '',
      haveMTechOD: user.haveMTechOD || joiner?.haveMTechOD || '',
      yearOfPassout: user.yearOfPassout || joiner?.yearOfPassout || '',
      status: user.status || joiner?.status || 'active'
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Get profile error:", error);
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      message: "Server error getting profile",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Update User Role (for promotions/demotions)
const updateUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;
    
    const user = await UserNew.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update role
    user.role = newRole;
    await user.save();

    // If user has joiner data, update it too
    if (user.joinerId) {
      await Joiner.findByIdAndUpdate(user.joinerId, { role: newRole });
    }

    res.status(200).json({ 
      message: "User role updated successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Update role error:", error);
    res.status(500).json({ message: "Server error updating role" });
  }
};

// Update User Profile
const updateUserProfile = async (req, res) => {
  try {
    // Try UserNew model first
    let user = await UserNew.findById(req.user.id);
    let userModel = 'UserNew';
    
    // If not found, try old User model
    if (!user) {
      const User = require('../models/User');
      user = await User.findById(req.user.id);
      userModel = 'User';
    }

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Build update object with only the fields we want to update
    const updateFields = {};
    
    if (req.body.name !== undefined && req.body.name !== '') updateFields.name = req.body.name;
    if (req.body.email !== undefined && req.body.email !== '') updateFields.email = req.body.email;
    if (req.body.phone !== undefined) updateFields.phone = req.body.phone || null;
    if (req.body.department !== undefined) updateFields.department = req.body.department || null;
    if (req.body.qualification !== undefined) updateFields.qualification = req.body.qualification || null;
    
    // Handle genre - enum only allows "male", "female", "other", or null
    if (req.body.genre !== undefined) {
      const genreValue = req.body.genre?.trim().toLowerCase();
      if (genreValue === '' || genreValue === null || genreValue === undefined) {
        updateFields.genre = null;
      } else if (['male', 'female', 'other'].includes(genreValue)) {
        updateFields.genre = genreValue;
      }
      // If invalid value, don't update (keep existing)
    }
    
    if (req.body.joiningDate !== undefined && req.body.joiningDate !== '') {
      updateFields.joiningDate = req.body.joiningDate ? new Date(req.body.joiningDate) : user.joiningDate;
    }

    // Update password if provided
    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(req.body.password, salt);
      updateFields.passwordChanged = true;
    }

    // Use findByIdAndUpdate to avoid validation issues with unchanged fields like createdBy
    // Only update the fields we specify, don't touch createdBy or other fields
    // runValidators: false to avoid validating unchanged fields (like createdBy with invalid UUID)
    let updatedUser;
    if (userModel === 'UserNew') {
      updatedUser = await UserNew.findByIdAndUpdate(
        req.user.id,
        { $set: updateFields },
        { new: true, runValidators: false, setDefaultsOnInsert: false }
      );
    } else {
      // For old User model, use save method but only update specific fields
      if (updateFields.name) user.name = updateFields.name;
      if (updateFields.email) user.email = updateFields.email;
      if (updateFields.phone !== undefined) user.phone = updateFields.phone;
      if (updateFields.department !== undefined) user.department = updateFields.department;
      if (updateFields.qualification !== undefined) user.qualification = updateFields.qualification;
      if (updateFields.genre !== undefined) user.genre = updateFields.genre;
      if (updateFields.joiningDate !== undefined) user.joiningDate = updateFields.joiningDate;
      if (updateFields.password) {
        user.password = updateFields.password;
        user.passwordChanged = updateFields.passwordChanged;
      }
      updatedUser = await user.save();
    }
    
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found after update" });
    }

    // If user has joinerId, also update the Joiner record with all profile fields
    if (userModel === 'UserNew' && user.joinerId) {
      try {
        const joiner = await Joiner.findById(user.joinerId);
        if (joiner) {
          // Basic fields
          if (req.body.name !== undefined) {
            joiner.name = req.body.name;
            joiner.candidate_name = req.body.name; // Also update candidate_name
          }
          if (req.body.email !== undefined) {
            joiner.email = req.body.email;
            joiner.candidate_personal_mail_id = req.body.email; // Also update candidate_personal_mail_id
          }
          if (req.body.phone !== undefined) {
            joiner.phone = req.body.phone;
            joiner.phone_number = req.body.phone; // Also update phone_number
          }
          if (req.body.phone_number !== undefined) {
            joiner.phone_number = req.body.phone_number;
            joiner.phone = req.body.phone_number; // Also update phone
          }
          if (req.body.department !== undefined) joiner.department = req.body.department || null;
          if (req.body.employeeId !== undefined) joiner.employeeId = req.body.employeeId || null;
          if (req.body.qualification !== undefined) joiner.qualification = req.body.qualification || null;
          if (req.body.specialization !== undefined) joiner.specialization = req.body.specialization || null;
          if (req.body.state !== undefined) joiner.state = req.body.state || null;
          
          // Handle genre for joiner - enum allows "Male", "Female", "Other", "male", "female", "other", or null
          if (req.body.genre !== undefined) {
            const genreValue = req.body.genre?.trim();
            if (genreValue === '' || genreValue === null || genreValue === undefined) {
              joiner.genre = null;
            } else {
              // Normalize to proper case
              const normalized = genreValue.toLowerCase();
              if (['male', 'female', 'other'].includes(normalized)) {
                joiner.genre = normalized.charAt(0).toUpperCase() + normalized.slice(1);
              } else {
                // If invalid, try lowercase
                joiner.genre = normalized;
              }
            }
          }
          if (req.body.joiningDate !== undefined) {
            const joiningDate = req.body.joiningDate ? new Date(req.body.joiningDate) : null;
            joiner.joiningDate = joiningDate;
            joiner.date_of_joining = joiningDate; // Also update date_of_joining
          }
          if (req.body.date_of_joining !== undefined) {
            const dateOfJoining = req.body.date_of_joining ? new Date(req.body.date_of_joining) : null;
            joiner.date_of_joining = dateOfJoining;
            joiner.joiningDate = dateOfJoining; // Also update joiningDate
          }
          if (req.body.haveMTechPC !== undefined) joiner.haveMTechPC = req.body.haveMTechPC;
          if (req.body.haveMTechOD !== undefined) joiner.haveMTechOD = req.body.haveMTechOD;
          if (req.body.yearOfPassout !== undefined) joiner.yearOfPassout = req.body.yearOfPassout;
          await joiner.save();
        }
      } catch (joinerError) {
        console.error('Error updating joiner:', joinerError);
        // Don't fail the request if joiner update fails
      }
    }

    // Get full user data for response
    let fullUserData = null;
    if (userModel === 'UserNew' && updatedUser.getFullData) {
      fullUserData = await updatedUser.getFullData();
    }

    // Get joiner data for response if available
    let joinerData = null;
    if (userModel === 'UserNew' && updatedUser.joinerId) {
      try {
        joinerData = await Joiner.findById(updatedUser.joinerId);
      } catch (err) {
        console.error('Error fetching joiner for response:', err);
      }
    }

    res.json({
      success: true,
      user: {
        _id: updatedUser._id,
        author_id: updatedUser.author_id || updatedUser._id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        phone: updatedUser.phone || joinerData?.phone || joinerData?.phone_number || '',
        phone_number: joinerData?.phone_number || joinerData?.phone || updatedUser.phone || '',
        department: updatedUser.department || joinerData?.department || '',
        employeeId: joinerData?.employeeId || '',
        qualification: updatedUser.qualification || joinerData?.qualification || '',
        specialization: joinerData?.specialization || '',
        state: joinerData?.state || '',
        genre: updatedUser.genre || joinerData?.genre || '',
        joiningDate: updatedUser.joiningDate || joinerData?.joiningDate || joinerData?.date_of_joining || null,
        date_of_joining: joinerData?.date_of_joining || joinerData?.joiningDate || updatedUser.joiningDate || null,
        haveMTechPC: joinerData?.haveMTechPC || '',
        haveMTechOD: joinerData?.haveMTechOD || '',
        yearOfPassout: joinerData?.yearOfPassout || '',
        joinerData: fullUserData?.joinerData || joinerData || null,
        token: generateToken(updatedUser._id),
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Change Password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id; // Use _id instead of id

    // Get user from database - try UserNew first, then User
    let user = await UserNew.findById(userId);
    if (!user) {
      const User = require('../models/User');
      user = await User.findById(userId);
      }
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found in any model" });
    }

    // Verify current password
    let isCurrentPasswordValid = false;
    
    // For first-time login, check tempPassword
    if (user.tempPassword && !user.passwordChanged) {
      isCurrentPasswordValid = (currentPassword === user.tempPassword);
      } else {
      // For regular password changes, check hashed password
      isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      }
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);
    // Update password and mark as changed
    let updateResult;
    
    // Try to update in the same model where user was found
    if (user.constructor.modelName === 'UserNew') {
      updateResult = await UserNew.findByIdAndUpdate(userId, {
        password: hashedNewPassword,
        passwordChanged: true,
        tempPassword: null // Clear temporary password
      });
    } else {
      // For old User model, we need to check if it has these fields
      const User = require('../models/User');
      updateResult = await User.findByIdAndUpdate(userId, {
        password: hashedNewPassword,
        passwordChanged: true,
        tempPassword: null // Clear temporary password
      });
    }
    
    res.json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  updateUserRole
};
