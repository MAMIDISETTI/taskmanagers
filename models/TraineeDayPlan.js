const mongoose = require("mongoose");

const TraineeDayPlanSchema = new mongoose.Schema(
  {
    // Trainee information
    trainee: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    
    // Day plan title
    title: { type: String, required: false, default: "" },
    
    // Day plan date
    date: { type: Date, required: true },
    
    // Topics (new format with nested structure)
    topics: {
      type: mongoose.Schema.Types.Mixed,
      default: []
    },
    
    // Tasks submitted by trainee
    tasks: [{
      id: { type: String, required: false }, // Frontend task ID for checkbox mapping
      title: { type: String, required: true },
      timeAllocation: { type: String, required: true }, // Format: "9:05am-12:20pm"
      description: { type: String, required: false, default: "" },
      status: { 
        type: String, 
        enum: ["completed", "in_progress", "pending"], 
        default: null 
      },
      remarks: { type: String, default: "" },
      updatedAt: { type: Date, default: null }
    }],
    
    // Dynamic checkboxes submitted by trainee
    checkboxes: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Status tracking
    status: { 
      type: String, 
      enum: ["draft", "in_progress", "approved", "completed", "rejected", "pending"], 
      default: "draft" 
    },
    
    // Who created this day plan
    createdBy: { 
      type: String, 
      enum: ["trainee", "trainer"], 
      default: "trainee" 
    },
    
    // Submission details
    submittedAt: { type: Date, default: null },
    
    // Review details (for trainers)
    reviewedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
    reviewedAt: { type: Date, default: null },
    reviewComments: { type: String, default: "" },
    
    // Approval details
    approvedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
    approvedAt: { type: Date, default: null },
    approvalComments: { type: String, default: "" },
    
    // EOD Update details
    eodUpdate: {
      submittedAt: { type: Date, default: null },
      overallRemarks: { type: String, default: "" },
      status: { 
        type: String, 
        enum: ["submitted", "approved", "rejected"], 
        default: null 
      },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User" 
      },
      reviewComments: { type: String, default: "" }
    }
  },
  { timestamps: true }
);

// Index for efficient queries
TraineeDayPlanSchema.index({ trainee: 1, date: -1 });
TraineeDayPlanSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model("TraineeDayPlan", TraineeDayPlanSchema);
