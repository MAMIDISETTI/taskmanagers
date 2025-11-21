const Joiner = require('../models/Joiner');
const User = require('../models/User');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Generate UUID v4 using crypto module
const generateUUID = () => {
  return crypto.randomUUID();
};

// @desc    Validate Google Sheets data and fetch data
// @route   POST /api/joiners/validate-sheets
// @access  Private (BOA)
const validateGoogleSheets = async (req, res) => {
  try {
    const { spread_sheet_name, data_sets_to_be_loaded, google_sheet_url } = req.body;

    if (!spread_sheet_name || !data_sets_to_be_loaded) {
      return res.status(400).json({ 
        message: 'Missing required fields: spread_sheet_name, data_sets_to_be_loaded' 
      });
    }

    // If Google Sheet URL is provided, try to fetch data
    if (google_sheet_url && google_sheet_url.trim()) {
      try {
        const gsRes = await axios.get(google_sheet_url);
        
        // Check if response is HTML (error page)
        if (typeof gsRes.data === 'string' && gsRes.data.includes('<!DOCTYPE html>')) {
          return res.status(400).json({
            message: 'Google Sheets URL returned HTML instead of JSON. Please check your Apps Script deployment.',
            received: 'HTML',
            suggestion: 'Make sure your Google Apps Script is properly deployed and returns JSON data'
          });
        }

        const sheetData = gsRes.data;

        // Check if response is valid JSON object
        if (typeof sheetData !== 'object' || sheetData === null) {
          return res.status(400).json({
            message: 'Invalid response from Google Sheets. Expected JSON object.',
            received: typeof sheetData,
            data: sheetData
          });
        }

        // Check if spread_sheet_name matches
        if (sheetData.spread_sheet_name !== spread_sheet_name) {
          return res.status(400).json({
            message: 'Spreadsheet name does not match',
            expected: spread_sheet_name,
            actual: sheetData.spread_sheet_name
          });
        }

        // Check if data_sets_to_be_loaded matches
        if (!Array.isArray(sheetData.data_sets_to_be_loaded) || 
            !data_sets_to_be_loaded.every(dataset => 
              sheetData.data_sets_to_be_loaded.includes(dataset)
            )) {
          return res.status(400).json({
            message: 'Data sets do not match',
            expected: data_sets_to_be_loaded,
            actual: sheetData.data_sets_to_be_loaded
          });
        }

        // Workaround: Fix phone_number if it's null
        // The Google Apps Script might not be reading the phone_number column correctly
        // This tries to find it in alternative field names or handle numeric values
        if (sheetData.data && Array.isArray(sheetData.data)) {
          sheetData.data.forEach((record, index) => {
            // If phone_number is null, undefined, or empty, try to fix it
            if (!record.phone_number || record.phone_number === null || record.phone_number === '') {
              // First, try common field name variations
              const phoneFields = [
                'Phone_number', 'PhoneNumber', 'phoneNumber',
                'Phone Number', 'Phone_Number', 'PHONE_NUMBER',
                'phone', 'Phone', 'PHONE', 'mobile', 'Mobile', 'MOBILE',
                'contact_number', 'Contact_Number', 'CONTACT_NUMBER'
              ];
              
              let foundPhone = null;
              for (const field of phoneFields) {
                if (record[field] !== null && record[field] !== undefined && record[field] !== '') {
                  foundPhone = record[field];
                  break;
                }
              }
              
              // If found, use it
              if (foundPhone !== null) {
                // Convert to string if it's a number
                record.phone_number = typeof foundPhone === 'number' ? foundPhone.toString() : foundPhone;
              } else {
                // Check all fields for numeric values that look like phone numbers (10 digits)
                for (const [key, value] of Object.entries(record)) {
                  if (value !== null && value !== undefined && value !== '') {
                    const numValue = typeof value === 'number' ? value.toString() : String(value).trim();
                    // Check if it looks like a phone number (10 digits, or starts with + and has 10+ digits)
                    if (/^[\+]?[0-9]{10,15}$/.test(numValue.replace(/[^\d+]/g, ''))) {
                      record.phone_number = numValue;
                      break;
                    }
                  }
                }
              }
              
            } else {
              // phone_number exists but might be a number - convert to string
              if (typeof record.phone_number === 'number') {
                record.phone_number = record.phone_number.toString();
              }
            }
          });
        }

        res.status(200).json({
          message: 'Google Sheets validation successful',
          data: sheetData
        });

      } catch (error) {
        return res.status(400).json({
          message: 'Failed to fetch data from Google Sheets',
          error: error.message,
          details: error.response?.data
        });
      }
    } else {
      // No Google Sheet URL provided, return mock data for manual entry
      const mockSheetData = {
        spread_sheet_name: spread_sheet_name,
        data_sets_to_be_loaded: data_sets_to_be_loaded,
        data: [],
        headers: [],
        total_rows: 0,
        message: 'No Google Sheet URL provided. You can add data manually.'
      };

      res.status(200).json({
        message: 'Configuration validated (Manual mode)',
        data: mockSheetData
      });
    }

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Process bulk joiner data
// @route   POST /api/joiners/bulk-upload
// @access  Private (BOA)
const bulkUploadJoiners = async (req, res) => {
  try {
    // Validate authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        message: 'Authentication required. Please log in again.'
      });
    }

    const { 
      spread_sheet_name, 
      data_sets_to_be_loaded, 
      google_sheet_url,
      joiners_data 
    } = req.body;

    if (!joiners_data || !Array.isArray(joiners_data)) {
      return res.status(400).json({ 
        message: 'joiners_data is required and must be an array',
        received: typeof joiners_data,
        isArray: Array.isArray(joiners_data)
      });
    }

    if (joiners_data.length === 0) {
      return res.status(400).json({ 
        message: 'joiners_data array is empty. Please provide at least one joiner record.' 
      });
    }

    // Skip Google Sheets validation in direct mode
    // // Process each joiner data
    const processedJoiners = [];
    const errors = [];
    
    // Batch check for existing joiners to improve performance
    // Collect all emails and author_ids first
    const emailsToCheck = [];
    const authorIdsToCheck = [];
    
    // First pass: collect all emails and author_ids
    for (let i = 0; i < joiners_data.length; i++) {
      const joinerData = joiners_data[i];
      const email = (joinerData.candidate_personal_mail_id || '').toString().trim().toLowerCase();
      if (email) emailsToCheck.push(email);
      
      // Check for provided author_id
      let providedAuthorId = null;
      if (joinerData.author_id !== undefined && joinerData.author_id !== null && joinerData.author_id !== '') {
        providedAuthorId = String(joinerData.author_id).trim();
      } else if (joinerData.authorId !== undefined && joinerData.authorId !== null && joinerData.authorId !== '') {
        providedAuthorId = String(joinerData.authorId).trim();
      }
      
      if (providedAuthorId) {
        const isValidUUID = (str) => {
          if (!str || typeof str !== 'string') return false;
          const trimmed = str.trim();
          if (trimmed === '') return false;
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return uuidRegex.test(trimmed);
        };
        if (isValidUUID(providedAuthorId)) {
          authorIdsToCheck.push(providedAuthorId);
        }
      }
    }
    
    // Batch query for existing joiners (only if we have values to check)
    const existingJoinersByEmail = emailsToCheck.length > 0 
      ? await Joiner.find({
          candidate_personal_mail_id: { $in: emailsToCheck }
        }).select('candidate_personal_mail_id author_id').lean()
      : [];
    
    const existingJoinersByAuthorId = authorIdsToCheck.length > 0
      ? await Joiner.find({
          author_id: { $in: authorIdsToCheck }
        }).select('author_id candidate_personal_mail_id email').lean()
      : [];
    
    // Create lookup maps for O(1) access
    const existingEmailsMap = new Map();
    existingJoinersByEmail.forEach(j => {
      if (j.candidate_personal_mail_id) {
        existingEmailsMap.set(j.candidate_personal_mail_id.toLowerCase(), j);
      }
    });
    
    const existingAuthorIdsMap = new Map();
    existingJoinersByAuthorId.forEach(j => {
      if (j.author_id) {
        existingAuthorIdsMap.set(j.author_id, j);
      }
    });

    // Second pass: process each joiner with batch-checked duplicates
    for (let i = 0; i < joiners_data.length; i++) {
      try {
        const joinerData = joiners_data[i];
        
        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
          if (value === '' || value === null || value === undefined) return null;
          return value;
        };
        
        // Helper function to validate UUID format
        const isValidUUID = (str) => {
          if (!str || typeof str !== 'string') return false;
          const trimmed = str.trim();
          if (trimmed === '') return false;
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return uuidRegex.test(trimmed);
        };
        
        // Try to get author_id from multiple possible field names
        let providedAuthorId = null;
        if (joinerData.author_id !== undefined && joinerData.author_id !== null && joinerData.author_id !== '') {
          providedAuthorId = String(joinerData.author_id).trim();
        } else if (joinerData.authorId !== undefined && joinerData.authorId !== null && joinerData.authorId !== '') {
          providedAuthorId = String(joinerData.authorId).trim();
        }
        
        // Use provided author_id if available and valid, otherwise generate a new one
        let author_id;
        if (providedAuthorId) {
          if (isValidUUID(providedAuthorId)) {
            author_id = providedAuthorId;
          } else {
            // Invalid UUID format - warn but still use it (user might have custom format)
            // Or generate new one - let's generate new one to maintain UUID standard
            errors.push(`Row ${i + 1}: Invalid author_id format "${providedAuthorId}". Expected UUID format (e.g., 8-4-4-4-12 hex). Generating new author_id.`);
            author_id = generateUUID();
          }
        } else {
          // Generate new author_id if not provided
          author_id = generateUUID();
        }

        // Clean and normalize email
        const email = (joinerData.candidate_personal_mail_id || '').toString().trim().toLowerCase();
        
        // Map the data to our schema based on your exact data structure
        const mappedData = {
          // Required fields with proper fallbacks
          name: (joinerData.candidate_name || 'Unknown').trim(),
          email: email,
          phone: null, // Will be set after phone validation
          department: 'OTHERS', // Will be validated later
          role: 'trainee', // Default role since role_type is "Full-time" which is not in our enum
          joiningDate: joinerData.date_of_joining ? new Date(joinerData.date_of_joining) : new Date(),
          
          // Optional fields with proper null handling
          candidate_name: nullIfEmpty(joinerData.candidate_name)?.trim(),
          candidate_personal_mail_id: email,
          phone_number: null, // Will be set after phone validation
          top_department_name_as_per_darwinbox: nullIfEmpty(joinerData.top_department_name_as_per_darwinbox)?.trim(),
          department_name_as_per_darwinbox: nullIfEmpty(joinerData.department_name_as_per_darwinbox)?.trim(),
          date_of_joining: joinerData.date_of_joining ? new Date(joinerData.date_of_joining) : null,
          joining_status: nullIfEmpty(joinerData.joining_status)?.toLowerCase().trim() || 'pending',
          role_type: nullIfEmpty(joinerData.role_type)?.trim(),
          role_assign: (nullIfEmpty(joinerData.role_assign)?.trim() || 'OTHER').toUpperCase(),
          qualification: nullIfEmpty(joinerData.qualification)?.trim(),
          author_id: author_id, // Generated UUID
          employeeId: nullIfEmpty(joinerData.employee_id)?.trim(),
          genre: nullIfEmpty(joinerData.genre) ? 
            nullIfEmpty(joinerData.genre).trim().charAt(0).toUpperCase() + nullIfEmpty(joinerData.genre).trim().slice(1).toLowerCase() : 
            null,
          status: 'pending',
          accountCreated: false,
          accountCreatedAt: null,
          createdBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : null,
          
          // Onboarding checklist
          onboardingChecklist: {
            welcomeEmailSent: false,
            credentialsGenerated: false,
            accountActivated: false,
            trainingAssigned: false,
            documentsSubmitted: false
          }
        };
        
        // Set department - must be one of the enum values
        const deptValue = nullIfEmpty(joinerData.top_department_name_as_per_darwinbox)?.trim();
        if (deptValue) {
          // Try to match department name to enum values
          const deptUpper = deptValue.toUpperCase();
          if (['IT', 'HR', 'FINANCE', 'SDM', 'SDI', 'OTHERS'].includes(deptUpper)) {
            mappedData.department = deptUpper;
          } else {
            mappedData.department = 'OTHERS';
          }
        } else {
          mappedData.department = 'OTHERS';
        }

            // Debug: Log the date being processed
            // // Validate required fields based on your Google Sheet structure
            if (!joinerData.candidate_name) {
              errors.push(`Row ${i + 1}: candidate_name is required`);
              continue;
            }

        if (!joinerData.candidate_personal_mail_id) {
          errors.push(`Row ${i + 1}: candidate_personal_mail_id is required`);
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(joinerData.candidate_personal_mail_id)) {
          errors.push(`Row ${i + 1}: Invalid email format: ${joinerData.candidate_personal_mail_id}`);
          continue;
        }

        // Try multiple variations of phone_number field name (case-insensitive)
        // Check if phone_number exists in any form - be more lenient
        let phoneNumber = null;
        
        // First, try the exact field name (case-sensitive) - but allow if it's a number (even 0)
        if (joinerData.phone_number !== null && joinerData.phone_number !== undefined) {
          // If it's a number (including 0), convert to string
          if (typeof joinerData.phone_number === 'number') {
            phoneNumber = joinerData.phone_number.toString();
          } else if (typeof joinerData.phone_number === 'string' && joinerData.phone_number.trim() !== '') {
            phoneNumber = joinerData.phone_number;
          }
        }
        
        // If not found, try case variations
        if ((phoneNumber === null || phoneNumber === undefined || phoneNumber === '') && 
            (joinerData.phone_number === null || joinerData.phone_number === undefined || joinerData.phone_number === '')) {
          const phoneFields = [
            'Phone_number', 'PhoneNumber', 'phoneNumber',
            'Phone Number', 'Phone_Number', 'PHONE_NUMBER'
          ];
          
          for (const field of phoneFields) {
            if (joinerData.hasOwnProperty(field) && 
                joinerData[field] !== null && 
                joinerData[field] !== undefined && 
                joinerData[field] !== '') {
              phoneNumber = typeof joinerData[field] === 'number' 
                ? joinerData[field].toString() 
                : joinerData[field];
              break;
            }
          }
        }


        // Validate phone number exists and is not empty
        // Handle number 0 as valid (though unlikely for phone)
        // Make phone_number optional - if not provided, set to null
        if (phoneNumber === null || 
            phoneNumber === undefined || 
            phoneNumber === '' ||
            (typeof phoneNumber === 'string' && phoneNumber.trim() === '')) {
          // Phone number is optional - set to null instead of erroring
          mappedData.phone = null;
          mappedData.phone_number = null;
          // Continue processing without phone number
        } else {
          // Convert to string and validate phone format - more flexible regex
          const phoneStr = phoneNumber.toString().trim();
          
          // Remove any non-digit characters except + at the start, then remove + if present
          let cleanedPhone = phoneStr.replace(/[^\d+]/g, '');
          if (cleanedPhone.startsWith('+')) {
            cleanedPhone = cleanedPhone.substring(1);
          }
          
          // Validate phone format - must be 10-15 digits
          const phoneRegex = /^[0-9]{10,15}$/;
          if (!phoneRegex.test(cleanedPhone)) {
            errors.push(`Row ${i + 1}: Invalid phone format: ${phoneStr} (cleaned: ${cleanedPhone}). Phone must be 10-15 digits.`);
            continue;
          }

          // Update joinerData with the found phone number (use cleaned version if needed)
          joinerData.phone_number = cleanedPhone || phoneStr;
          
          // Update mappedData with cleaned phone number
          mappedData.phone = cleanedPhone || phoneStr;
          mappedData.phone_number = cleanedPhone || phoneStr;
        }

        // Validate role_assign if provided
        if (joinerData.role_assign && joinerData.role_assign.trim() !== '' && 
            !['SDM', 'SDI', 'SDF', 'SDB', 'OTHER'].includes(joinerData.role_assign.trim())) {
          errors.push(`Row ${i + 1}: Invalid role_assign value: ${joinerData.role_assign}. Must be one of: SDM, SDI, SDF, SDB, OTHER`);
          continue;
        }

        // Check if joiner already exists (using pre-fetched data)
        const existingJoinerByEmail = existingEmailsMap.get(mappedData.candidate_personal_mail_id);
        
        if (existingJoinerByEmail) {
          errors.push(`Row ${i + 1}: Joiner with email ${mappedData.candidate_personal_mail_id} already exists (existing author_id: ${existingJoinerByEmail.author_id || 'N/A'})`);
          continue;
        }
        
        // Then check by author_id (only if we're using a provided one, not a newly generated one)
        if (providedAuthorId && isValidUUID(providedAuthorId)) {
          const existingJoinerByAuthorId = existingAuthorIdsMap.get(mappedData.author_id);
          
          if (existingJoinerByAuthorId) {
            errors.push(`Row ${i + 1}: Joiner with author_id ${mappedData.author_id} already exists (email: ${existingJoinerByAuthorId.candidate_personal_mail_id || existingJoinerByAuthorId.email || 'N/A'})`);
            continue;
          }
        }

        processedJoiners.push(mappedData);

      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    // If there are errors but also some valid joiners, still insert the valid ones
    // But return a warning response instead of error
    if (errors.length > 0 && processedJoiners.length === 0) {
      return res.status(400).json({
        message: 'Validation errors found - no valid joiners to insert',
        errors: errors,
        processedCount: 0,
        totalCount: joiners_data.length
      });
    }
    
    // If there are errors but some valid joiners, we'll still insert valid ones
    // and return success with warnings
    const hasErrors = errors.length > 0;

    // Insert all valid joiners
    let createdJoiners;
    try {
      // Use insertMany with ordered: false for better performance
      // Skip individual validation - Mongoose will validate on insert
      if (processedJoiners.length === 0) {
        return res.status(400).json({
          message: 'No valid joiners to insert after validation',
          errors: errors,
          totalCount: joiners_data.length
        });
      }
      
      createdJoiners = await Joiner.insertMany(processedJoiners, { 
        ordered: false,
        rawResult: false
      });
    } catch (dbError) {
      // Handle bulk write errors
      if (dbError.name === 'BulkWriteError' && dbError.writeErrors) {
        const writeErrors = dbError.writeErrors.map(err => ({
          index: err.index,
          error: err.errmsg || err.err.message,
          data: processedJoiners[err.index]
        }));
        
        return res.status(500).json({
          message: 'Database insertion failed',
          insertedCount: dbError.result?.insertedCount || 0,
          errorCount: writeErrors.length,
          errors: writeErrors,
          errorName: dbError.name,
          errorCode: dbError.code
        });
      }
      
      return res.status(500).json({
        message: 'Database insertion failed',
        error: dbError.message,
        errorName: dbError.name,
        errorCode: dbError.code,
        details: dbError.toString(),
        stack: dbError.stack
      });
    }

    // Return success even if there were some validation errors (partial success)
    const statusCode = hasErrors ? 200 : 201;
    res.status(statusCode).json({
      message: hasErrors 
        ? `Bulk upload completed with ${createdJoiners.length} successful and ${errors.length} errors`
        : 'Bulk upload successful',
      createdCount: createdJoiners.length,
      totalCount: joiners_data.length,
      errorCount: errors.length,
      errors: hasErrors ? errors : undefined,
      joiners: createdJoiners
    });

  } catch (error) {
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message,
      details: error.stack,
      type: error.name
    });
  }
};

// @desc    Test Google Sheets URL
// @route   GET /api/joiners/test-sheets
// @access  Private (BOA)
const testGoogleSheets = async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ 
        message: 'URL parameter is required' 
      });
    }

    // const response = await axios.get(url);
    
    res.status(200).json({
      message: 'URL test successful',
      status: response.status,
      dataType: typeof response.data,
      data: response.data,
      headers: response.headers
    });

  } catch (error) {
    res.status(400).json({
      message: 'URL test failed',
      error: error.message,
      details: error.response?.data
    });
  }
};

module.exports = {
  validateGoogleSheets,
  bulkUploadJoiners,
  testGoogleSheets
};
