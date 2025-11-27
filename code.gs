
// === CONFIGURATION ===
const BUFFER_SHEET_ID = "19OLhS4OzvtgPsVHKVigjvrw3YR9K-sWf0U-TWvJ1Ftw"; 
const SPREADSHEET_ID = "1FotLFASWuFinDnvpyLTsyO51OpJeKWtuG31VFje3Oik"; // Only the ID
const SICK_NOTE_FOLDER_ID = "1Wu_eoEQ3FmfrzOdAwJkqMu4sPucLRu_0";
const SHEET_NAMES = {
  adherence: "Adherence Tracker",
  employeesCore: "Employees_Core", 
  employeesPII: "Employees_PII",   
  assets: "Assets",                
  projects: "Projects",            
  projectLogs: "Project_Logs",     
  schedule: "Schedules",
  logs: "Logs",
  otherCodes: "Other Codes",
  leaveRequests: "Leave Requests", 
  coachingSessions: "CoachingSessions", 
  coachingScores: "CoachingScores", 
  coachingTemplates: "CoachingTemplates", 
  pendingRegistrations: "PendingRegistrations",
  movementRequests: "MovementRequests",
  announcements: "Announcements",
  roleRequests: "Role Requests",
  recruitment: "Recruitment_Candidates",
  requisitions: "Requisitions",
  performance: "Performance_Reviews", 
  historyLogs: "Employee_History",
  warnings: "Warnings",
  financialEntitlements: "Financial_Entitlements",
  rbac: "RBAC_Config",// NEW
  overtime: "Overtime_Requests",
  breakConfig: "Break_Config"
};
// --- Break Time Configuration (in seconds) ---
const PLANNED_BREAK_SECONDS = 15 * 60; // 15 minutes
const PLANNED_LUNCH_SECONDS = 30 * 60; // 30 minutes

// --- Shift Cutoff Hour (e.g., 7 = 7 AM) ---
const SHIFT_CUTOFF_HOUR = 7; 

// ================= WEB APP ENTRY (PHASE 4 UPDATED) =================
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('KOMPASS (Internal)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// ================= WEB APP APIs (UPDATED) =================

// - REPLACEMENT (PHASE 3 UPDATED)
function webPunch(action, targetUserName, adminTimestamp, projectId) { 
  try {
    // 1. SMART CONTEXT (Load Data)
    const { userEmail, userName: selfName, userData, ss } = getAuthorizedContext(null);
    
    // 2. Validate Target
    const targetEmail = userData.nameToEmail[targetUserName];
    if (!targetEmail) throw new Error(`User "${targetUserName}" not found.`);
    
    // 3. PERMISSION CHECK
    if (targetEmail.toLowerCase() !== userEmail.toLowerCase()) {
        getAuthorizedContext('PUNCH_OTHERS'); // Throws error if missing permission
    }

    // 4. Run Logic
    const puncherEmail = userEmail;
    const resultMessage = punch(action, targetUserName, puncherEmail, adminTimestamp);
    if (projectId || action === "Logout") {
      logProjectHours(targetUserName, action, projectId, adminTimestamp);
    }

    // 5. Get New Status
    const timeZone = Session.getScriptTimeZone();
    const now = adminTimestamp ? new Date(adminTimestamp) : new Date();
    const shiftDate = getShiftDate(now, SHIFT_CUTOFF_HOUR);
    const formattedDate = Utilities.formatDate(shiftDate, timeZone, "MM/dd/yyyy");
    const newStatus = getLatestPunchStatus(targetEmail, targetUserName, shiftDate, formattedDate);
    
    return { message: resultMessage, newStatus: newStatus };
  } catch (err) { return { message: "Error: " + err.message, newStatus: null }; }
}

// === NEW HELPER FOR PHASE 3 ===
function logProjectHours(userName, action, newProjectId, customTime) {
  const ss = getSpreadsheet();
  const coreSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const logSheet = getOrCreateSheet(ss, SHEET_NAMES.projectLogs);
  const data = coreSheet.getDataRange().getValues();
  
  // 1. Find User Row & Current State
  let userRowIndex = -1;
  let currentProjectId = "";
  let lastActionTime = null;
  let empID = "";

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === userName) { // Match Name
      userRowIndex = i + 1;
      empID = data[i][0]; // EmployeeID is Col A
      // We use Column K (Index 10) for "CurrentProject" and L (Index 11) for "LastActionTime"
      // If they don't exist yet, we treat them as empty.
      currentProjectId = data[i][10] || ""; 
      lastActionTime = data[i][11] ? new Date(data[i][11]) : null;
      break;
    }
  }

  if (userRowIndex === -1) return; // Should not happen

  const now = customTime ? new Date(customTime) : new Date();

  // 2. If they were working on a project, calculate duration and log it
  if (currentProjectId && lastActionTime) {
    const durationHours = (now.getTime() - lastActionTime.getTime()) / (1000 * 60 * 60);
    
    if (durationHours > 0) {
      logSheet.appendRow([
        `LOG-${new Date().getTime()}`, // LogID
        empID,
        currentProjectId,
        new Date(), // Date of log
        durationHours.toFixed(2) // Duration
      ]);
    }
  }

  // 3. Update State in Employees_Core
  // If Logout, clear the project. If Login/Switch, set the new project.
  if (action === "Logout") {
    coreSheet.getRange(userRowIndex, 11).setValue(""); // Clear Project
    coreSheet.getRange(userRowIndex, 12).setValue(""); // Clear Time
  } else {
    coreSheet.getRange(userRowIndex, 11).setValue(newProjectId); // Set New Project
    coreSheet.getRange(userRowIndex, 12).setValue(now); // Set Start Time
  }
}

function webSubmitScheduleRange(userEmail, userName, startDateStr, endDateStr, startTime, endTime, leaveType, shiftEndDate) {
  try {
    const { userEmail: puncherEmail } = getAuthorizedContext('EDIT_SCHEDULE');
    return submitScheduleRange(puncherEmail, userEmail, userName, startDateStr, endDateStr, startTime, endTime, leaveType, shiftEndDate);
  } catch (err) { return "Error: " + err.message; }
}

// === Web App APIs for Leave Requests ===
function webSubmitLeaveRequest(requestObject, targetUserEmail) { // Now accepts optional target user
  try {
    const submitterEmail = Session.getActiveUser().getEmail().toLowerCase();
    return submitLeaveRequest(submitterEmail, requestObject, targetUserEmail);
  } catch (err) {
    return "Error: " + err.message;
  }
}

function webGetMyRequests_V2() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    return getMyRequests(userEmail); 
  } catch (err) {
    Logger.log("Error in webGetMyRequests_V2: " + err.message);
    throw new Error(err.message); 
  }
}

function webGetAdminLeaveRequests(filter) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    return getAdminLeaveRequests(adminEmail, filter);
  } catch (err) {
    Logger.log("webGetAdminLeaveRequests Error: " + err.message);
    return { error: err.message };
  }
}

function webApproveDenyRequest(requestID, newStatus, reason) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    return approveDenyRequest(adminEmail, requestID, newStatus, reason);
  } catch (err) {
    return "Error: " + err.message;
  }
}

// === Web App API for History ===
function webGetAdherenceRange(userNames, startDateStr, endDateStr) {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    return getAdherenceRange(userEmail, userNames, startDateStr, endDateStr);
  } catch (err) {
    return { error: "Error: " + err.message };
  }
}

// === Web App API for My Schedule ===
function webGetMySchedule() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    return getMySchedule(userEmail);
  } catch (err) {
    return { error: "Error: " + err.message };
  }
}

// === Web App API for Admin Tools ===
function webAdjustLeaveBalance(userEmail, leaveType, amount, reason) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    return adjustLeaveBalance(adminEmail, userEmail, leaveType, amount, reason);
  } catch (err) {
    return "Error: " + err.message;
  }
}

function webImportScheduleCSV(csvData) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    return importScheduleCSV(adminEmail, csvData);
  } catch (err) {
    return "Error: " + err.message;
  }
}

// === Web App API for Dashboard ===
function webGetDashboardData(userEmails, date) { 
  try {
    const { userEmail: adminEmail } = getAuthorizedContext('VIEW_FULL_DASHBOARD');
    return getDashboardData(adminEmail, userEmails, date);
  } catch (err) {
    Logger.log("webGetDashboardData Error: " + err.message);
    throw new Error(err.message);
  }
}

// --- MODIFIED: "My Team" Functions ---
function webSaveMyTeam(userEmails) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    return saveMyTeam(adminEmail, userEmails);
  } catch (err) {
    return "Error: " + err.message;
  }
}

function webGetMyTeam() {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    return getMyTeam(adminEmail);
  } catch (err) {
    return "Error: " + err.message;
  }
}

// 2. Updated Reporting Line Change
function webSubmitMovementRequest(userToMoveEmail, newSupervisorEmail) {
  // Replaces hardcoded check with dynamic RBAC
  const { userEmail: requestedByEmail, userData, ss } = getAuthorizedContext('MANAGE_HIERARCHY');

  const userToMoveName = userData.emailToName[userToMoveEmail];
  const newSupervisorName = userData.emailToName[newSupervisorEmail];
  const fromSupervisorEmail = userData.emailToSupervisor[userToMoveEmail];

  if (!userToMoveName) throw new Error(`User to move (${userToMoveEmail}) not found.`);
  if (!newSupervisorName) throw new Error(`Receiving supervisor (${newSupervisorEmail}) not found.`);
  if (fromSupervisorEmail === newSupervisorEmail) throw new Error("User already reports to this supervisor.");

  const moveSheet = getOrCreateSheet(ss, SHEET_NAMES.movementRequests);
  moveSheet.appendRow([
    `MOV-${new Date().getTime()}`,
    "Pending",
    userToMoveEmail,
    userToMoveName,
    fromSupervisorEmail,
    newSupervisorEmail,
    new Date(),
    "", "", requestedByEmail
  ]);

  return `Movement request submitted for ${userToMoveName}.`;
}
/**
 * NEW: Fetches pending movement requests for the admin or their subordinates.
 */
function webGetPendingMovements() {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);

    // *** ADD THIS LINE TO FIX THE ERROR ***
    const adminRole = userData.emailToRole[adminEmail] || 'agent';
    
    // Get all subordinates (direct and indirect)
    const mySubordinateEmails = new Set(webGetAllSubordinateEmails(adminEmail));
    const moveSheet = getOrCreateSheet(ss, SHEET_NAMES.movementRequests);
    const data = moveSheet.getDataRange().getValues();
    const results = [];

    // Get headers
    const headers = data[0];
    const statusIndex = headers.indexOf("Status");
    const toSupervisorIndex = headers.indexOf("ToSupervisorEmail");
    
    if (statusIndex === -1 || toSupervisorIndex === -1) {
      throw new Error("MovementRequests sheet is missing required columns.");
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const status = row[statusIndex];
      const toSupervisorEmail = (row[toSupervisorIndex] || "").toLowerCase();

      if (status === 'Pending') {
        let canView = false;
        
        // --- NEW VIEWING LOGIC ---
        if (adminRole === 'superadmin') {
          // Superadmin can see ALL pending requests
          canView = true;
        } else if (toSupervisorEmail === adminEmail || mySubordinateEmails.has(toSupervisorEmail)) {
          // Admin can only see requests for themselves or their subordinates
          canView = true;
        }
        // --- END NEW LOGIC ---

        if (canView) {
          results.push({
            movementID: row[headers.indexOf("MovementID")],
            userToMoveName: row[headers.indexOf("UserToMoveName")],
            fromSupervisorName: userData.emailToName[row[headers.indexOf("FromSupervisorEmail")]] || "Unknown",
            
  toSupervisorName: userData.emailToName[row[headers.indexOf("ToSupervisorEmail")]] || "Unknown",
            requestedDate: convertDateToString(new Date(row[headers.indexOf("RequestTimestamp")])),
            requestedByName: userData.emailToName[row[headers.indexOf("RequestedByEmail")]] || "Unknown"
          });
}
      }
    }
    return results;
  } catch (e) {
    Logger.log("webGetPendingMovements Error: " + e.message);
    return { error: e.message };
  }
}

/**
 * NEW: Approves or denies a movement request.
 */
function webApproveDenyMovement(movementID, newStatus) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    const moveSheet = getOrCreateSheet(ss, SHEET_NAMES.movementRequests);
    const data = moveSheet.getDataRange().getValues();
    
    // Get headers
    const headers = data[0];
    const idIndex = headers.indexOf("MovementID");
    const statusIndex = headers.indexOf("Status");
    const toSupervisorIndex = headers.indexOf("ToSupervisorEmail");
    const userToMoveIndex = headers.indexOf("UserToMoveEmail");
    const actionTimeIndex = headers.indexOf("ActionTimestamp");
    const actionByIndex = headers.indexOf("ActionByEmail");

    let rowToUpdate = -1;
    let requestDetails = {};

    for (let i = 1; i < data.length; i++) {
      if (data[i][idIndex] === movementID) {
        rowToUpdate = i + 1; // 1-based index
        requestDetails = {
          status: data[i][statusIndex],
          toSupervisorEmail: (data[i][toSupervisorIndex] || "").toLowerCase(),
          userToMoveEmail: (data[i][userToMoveIndex] || "").toLowerCase()
        };
        break;
      }
    }

    if (rowToUpdate === -1) {
      throw new Error("Movement request not found.");
    }
    if (requestDetails.status !== 'Pending') {
      throw new Error(`This request has already been ${requestDetails.status}.`);
    }

    // --- MODIFIED: Security Check ---
    // An admin can action a request if it's FOR them, or FOR a supervisor in their hierarchy.
    
    // Get all subordinates (direct and indirect)
    const mySubordinateEmails = new Set(webGetAllSubordinateEmails(adminEmail));
    
    const isReceivingSupervisor = (requestDetails.toSupervisorEmail === adminEmail);
    // Check if the request is for someone who reports to the admin
    const isSupervisorOfReceiver = mySubordinateEmails.has(requestDetails.toSupervisorEmail);

    if (!isReceivingSupervisor && !isSupervisorOfReceiver) {
      // This check covers all roles. 
      // An Admin/Superadmin can only approve for their own hierarchy (as you requested: "for a only not for b").
      throw new Error("Permission denied. You can only approve requests for yourself or for supervisors in your reporting line.");
    }
    // --- END MODIFICATION ---
    // All checks passed, update the status
    moveSheet.getRange(rowToUpdate, statusIndex + 1).setValue(newStatus);
    moveSheet.getRange(rowToUpdate, actionTimeIndex + 1).setValue(new Date());
    moveSheet.getRange(rowToUpdate, actionByIndex + 1).setValue(adminEmail);

    if (newStatus === 'Approved') {
      // Find the user in the Data Base
      const userDBRow = userData.emailToRow[requestDetails.userToMoveEmail];
      if (!userDBRow) {
        throw new Error(`Could not find user ${requestDetails.userToMoveEmail} in Data Base to update.`);
      }
      // Update their supervisor (Column G = 7)
      dbSheet.getRange(userDBRow, 7).setValue(requestDetails.toSupervisorEmail);

      // Log the change
      const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
      logsSheet.appendRow([
        new Date(), 
        userData.emailToName[requestDetails.userToMoveEmail] || "Unknown User", 
        adminEmail, 
        "Reporting Line Change Approved", 
        `MovementID: ${movementID}`
      ]);
    }
    
    SpreadsheetApp.flush();
    return { success: true, message: `Request has been ${newStatus}.` };

  } catch (e) {
    Logger.log("webApproveDenyMovement Error: " + e.message);
    return { error: e.message };
  }
}

/**
 * NEW: Fetches the movement history for a selected user.
 */
function webGetMovementHistory(selectedUserEmail) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    
    // Security check: Is this admin allowed to see this user's history?
    const adminRole = userData.emailToRole[adminEmail];
    const mySubordinateEmails = new Set(webGetAllSubordinateEmails(adminEmail));

    if (adminRole !== 'superadmin' && !mySubordinateEmails.has(selectedUserEmail)) {
      throw new Error("Permission denied. You can only view the history of users in your reporting line.");
    }
    
    const moveSheet = getOrCreateSheet(ss, SHEET_NAMES.movementRequests);
    const data = moveSheet.getDataRange().getValues();
    const headers = data[0];
    const results = [];

    // Find rows where the user was the one being moved
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const userToMoveEmail = (row[headers.indexOf("UserToMoveEmail")] || "").toLowerCase();
      
      if (userToMoveEmail === selectedUserEmail) {
        results.push({
          status: row[headers.indexOf("Status")],
          requestDate: convertDateToString(new Date(row[headers.indexOf("RequestTimestamp")])),
          actionDate: convertDateToString(new Date(row[headers.indexOf("ActionTimestamp")])),
          fromSupervisorName: userData.emailToName[row[headers.indexOf("FromSupervisorEmail")]] || "N/A",
          toSupervisorName: userData.emailToName[row[headers.indexOf("ToSupervisorEmail")]] || "N/A",
          actionByName: userData.emailToName[row[headers.indexOf("ActionByEmail")]] || "N/A",
          requestedByName: userData.emailToName[row[headers.indexOf("RequestedByEmail")]] || "N/A"
        });
      }
    }
    
    // Sort by request date, newest first
    results.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
    return results;

  } catch (e) {
    Logger.log("webGetMovementHistory Error: " + e.message);
    return { error: e.message };
  }
}

// ==========================================================
// === NEW/REPLACED COACHING FUNCTIONS (START) ===
// ==========================================================

/**
 * (REPLACED)
 * Saves a new coaching session and its detailed scores.
 * Matches the new frontend form.
 */
function webSubmitCoaching(sessionObject) {
  try {
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    const sessionSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingSessions);
    const scoreSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingScores);
    
    const coachEmail = Session.getActiveUser().getEmail().toLowerCase();
    const coachName = userData.emailToName[coachEmail] || coachEmail;
    
    // Simple validation
    if (!sessionObject.agentEmail || !sessionObject.sessionDate) {
      throw new Error("Agent and Session Date are required.");
    }

    const agentName = userData.emailToName[sessionObject.agentEmail.toLowerCase()];
    if (!agentName) {
      throw new Error(`Could not find agent with email ${sessionObject.agentEmail}.`);
    }

    const sessionID = `CS-${new Date().getTime()}`; // Simple unique ID
    const sessionDate = new Date(sessionObject.sessionDate + 'T00:00:00');
    // *** NEW: Handle FollowUpDate ***
    const followUpDate = sessionObject.followUpDate ? new Date(sessionObject.followUpDate + 'T00:00:00') : null;
    const followUpStatus = followUpDate ? "Pending" : ""; // Set to pending if date exists

    // 1. Log the main session
    sessionSheet.appendRow([
      sessionID,
      sessionObject.agentEmail,
      agentName,
      coachEmail,
      coachName,
      sessionDate,
      sessionObject.weekNumber,
      sessionObject.overallScore,
      sessionObject.followUpComment,
      new Date(), // Timestamp of submission
      followUpDate || "", // *** NEW: Add follow-up date ***
      followUpStatus  // *** NEW: Add follow-up status ***
    ]);

    // 2. Log the individual scores
    const scoresToLog = [];
    if (sessionObject.scores && Array.isArray(sessionObject.scores)) {
      sessionObject.scores.forEach(score => {
        scoresToLog.push([
          sessionID,
          score.category,
          score.criteria,
          score.score,
          score.comment
        ]);
      });
    }

    if (scoresToLog.length > 0) {
      scoreSheet.getRange(scoreSheet.getLastRow() + 1, 1, scoresToLog.length, 5).setValues(scoresToLog);
    }
    
    return `Coaching session for ${agentName} saved successfully.`;

  } catch (err) {
    Logger.log("webSubmitCoaching Error: " + err.message);
    return "Error: " + err.message;
  }
}

/**
 * (REPLACED)
 * Gets coaching history for the logged-in user or their team.
 * Reads from the new CoachingSessions sheet.
 */
function webGetCoachingHistory(filter) { // filter is unused for now, but good practice
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    const role = userData.emailToRole[userEmail] || 'agent';
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.coachingSessions);

    // Get all data as objects
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const allData = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    
    const allSessions = allData.map(row => {
      let obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });

    const results = [];
    
    // Get a list of users this person manages (if they are a manager)
    let myTeamEmails = new Set();
    if (role === 'admin' || role === 'superadmin') {
      // Use the hierarchy-aware function
      const myTeamList = webGetAllSubordinateEmails(userEmail);
      myTeamList.forEach(email => myTeamEmails.add(email.toLowerCase()));
    }

    for (let i = allSessions.length - 1; i >= 0; i--) {
      const session = allSessions[i];
      if (!session || !session.AgentEmail) continue; // Skip empty/invalid rows

      const agentEmail = session.AgentEmail.toLowerCase();

      let canView = false;
      
      // *** MODIFIED LOGIC HERE ***
      if (agentEmail === userEmail) {
        // Anyone can see their own coaching
        canView = true;
      } else if (role === 'admin' && myTeamEmails.has(agentEmail)) {
        // An admin can see their team's
        canView = true;
      } else if (role === 'superadmin') {
        // Superadmin can see all (team members + their own, which is covered above)
        canView = true;
      }
      // *** END MODIFIED LOGIC ***

      if (canView) {
        results.push({
          sessionID: session.SessionID,
          agentName: session.AgentName,
          coachName: session.CoachName,
          sessionDate: convertDateToString(new Date(session.SessionDate)),
          weekNumber: session.WeekNumber,
          overallScore: session.OverallScore,
          followUpComment: session.FollowUpComment,
          followUpDate: convertDateToString(new Date(session.FollowUpDate)),
          followUpStatus: session.FollowUpStatus,
          agentAcknowledgementTimestamp: convertDateToString(new Date(session.AgentAcknowledgementTimestamp))
        });
      }
    }
    return results;

  } catch (err) {
    Logger.log("webGetCoachingHistory Error: " + err.message);
    return { error: err.message };
  }
}

/**
 * NEW: Fetches the details for a single coaching session.
 * (MODIFIED: Renamed to webGetCoachingSessionDetails to be callable)
 * (MODIFIED 2: Added date-to-string conversion to fix null return)
 * (MODIFIED 3: Added AgentAcknowledgementTimestamp conversion)
 */
function webGetCoachingSessionDetails(sessionID) {
  try {
    const ss = getSpreadsheet();
    const sessionSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingSessions);
    const scoreSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingScores);

    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);

    // 1. Get Session Summary
    const sessionHeaders = sessionSheet.getRange(1, 1, 1, sessionSheet.getLastColumn()).getValues()[0];
    const sessionData = sessionSheet.getDataRange().getValues();
    let sessionSummary = null;

    for (let i = 1; i < sessionData.length; i++) {
      if (sessionData[i][0] === sessionID) {
        sessionSummary = {};
        sessionHeaders.forEach((header, index) => {
          sessionSummary[header] = sessionData[i][index];
        });
        break;
      }
    }

    if (!sessionSummary) {
      throw new Error("Session not found.");
    }

    // 2. Get Session Scores
    const scoreHeaders = scoreSheet.getRange(1, 1, 1, scoreSheet.getLastColumn()).getValues()[0];
    const scoreData = scoreSheet.getDataRange().getValues();
    const sessionScores = [];

    for (let i = 1; i < scoreData.length; i++) {
      if (scoreData[i][0] === sessionID) {
        let scoreObj = {};
        scoreHeaders.forEach((header, index) => {
          scoreObj[header] = scoreData[i][index];
        });
        sessionScores.push(scoreObj);
      }
    }
    
    sessionSummary.CoachName = userData.emailToName[sessionSummary.CoachEmail] || sessionSummary.CoachName;
    
    // *** Convert Date objects to Strings before returning ***
    sessionSummary.SessionDate = convertDateToString(new Date(sessionSummary.SessionDate));
    sessionSummary.SubmissionTimestamp = convertDateToString(new Date(sessionSummary.SubmissionTimestamp));
    sessionSummary.FollowUpDate = convertDateToString(new Date(sessionSummary.FollowUpDate));
    // *** NEW: Convert the new column ***
    sessionSummary.AgentAcknowledgementTimestamp = convertDateToString(new Date(sessionSummary.AgentAcknowledgementTimestamp));
    // *** END NEW SECTION ***

    return {
      summary: sessionSummary,
      scores: sessionScores
    };

  } catch (err) {
    Logger.log("webGetCoachingSessionDetails Error: " + err.message);
    return { error: err.message };
  }
}

/**
 * NEW: Updates the follow-up status for a coaching session.
 */
function webUpdateFollowUpStatus(sessionID, newStatus, newDateStr) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    
    // Check permission
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    const adminRole = userData.emailToRole[adminEmail] || 'agent';

    if (adminRole !== 'admin' && adminRole !== 'superadmin') {
      throw new Error("Permission denied. Only managers can update follow-up status.");
    }
    
    const sessionSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingSessions);
    const sessionData = sessionSheet.getDataRange().getValues();
    const sessionHeaders = sessionData[0];
    
    // Find the column indexes
    const statusColIndex = sessionHeaders.indexOf("FollowUpStatus");
    const dateColIndex = sessionHeaders.indexOf("FollowUpDate");
    
    if (statusColIndex === -1 || dateColIndex === -1) {
      throw new Error("Could not find 'FollowUpStatus' or 'FollowUpDate' columns in CoachingSessions sheet.");
    }

    // Find the row
    let sessionRow = -1;
    for (let i = 1; i < sessionData.length; i++) {
      if (sessionData[i][0] === sessionID) {
        sessionRow = i + 1; // 1-based index
        break;
      }
    }

    if (sessionRow === -1) {
      throw new Error("Session not found.");
    }

    // Prepare new values
    let newFollowUpDate = null;
    if (newDateStr) {
      newFollowUpDate = new Date(newDateStr + 'T00:00:00');
    } else {
      // If marking completed, use today's date
      newFollowUpDate = new Date();
    }
    
    // Update the sheet
    sessionSheet.getRange(sessionRow, statusColIndex + 1).setValue(newStatus);
    sessionSheet.getRange(sessionRow, dateColIndex + 1).setValue(newFollowUpDate);

    SpreadsheetApp.flush(); // Ensure changes are saved

    return { success: true, message: `Status updated to ${newStatus}.` };

  } catch (err) {
    Logger.log("webUpdateFollowUpStatus Error: " + err.message);
    return { error: err.message };
  }
}

/**
 * NEW: Allows an agent to acknowledge their coaching session.
 */
function webSubmitCoachingAcknowledgement(sessionID) {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const sessionSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingSessions);

    // *** MODIFIED: Explicitly read headers ***
    const sessionHeaders = sessionSheet.getRange(1, 1, 1, sessionSheet.getLastColumn()).getValues()[0];
    // Get data rows separately, skipping header
    const sessionData = sessionSheet.getRange(2, 1, sessionSheet.getLastRow() - 1, sessionSheet.getLastColumn()).getValues();

    // Find the column indexes
    const ackColIndex = sessionHeaders.indexOf("AgentAcknowledgementTimestamp");
    const agentEmailColIndex = sessionHeaders.indexOf("AgentEmail");
    if (ackColIndex === -1 || agentEmailColIndex === -1) {
      throw new Error("Could not find 'AgentAcknowledgementTimestamp' or 'AgentEmail' columns in CoachingSessions sheet.");
    }

    // Find the row
    let sessionRow = -1;
    let agentEmailOnRow = null;
    let currentAckStatus = null;

    // *** MODIFIED: Loop starts at 0 and row index is i + 2 ***
    for (let i = 0; i < sessionData.length; i++) {
      if (sessionData[i][0] === sessionID) {
        sessionRow = i + 2; // Data starts from row 2
        agentEmailOnRow = sessionData[i][agentEmailColIndex].toLowerCase();
        currentAckStatus = sessionData[i][ackColIndex];
        break;
      }
    }

    if (sessionRow === -1) {
      throw new Error("Session not found.");
    }
    
    // Security Check: Is this the correct agent?
    if (agentEmailOnRow !== userEmail) {
      throw new Error("Permission denied. You can only acknowledge your own coaching sessions.");
    }
    
    // Check if already acknowledged
    if (currentAckStatus) {
      return { success: false, message: "This session has already been acknowledged." };
    }
    
    // Update the sheet
    sessionSheet.getRange(sessionRow, ackColIndex + 1).setValue(new Date());

    SpreadsheetApp.flush(); // Ensure changes are saved

    return { success: true, message: "Coaching session acknowledged successfully." };

  } catch (err) {
    Logger.log("webSubmitCoachingAcknowledgement Error: " + err.message);
    return { error: err.message };
  }
}


/**
 * NEW: Gets a list of unique, active template names.
 */
function webGetActiveTemplates() {
  try {
    const ss = getSpreadsheet();
    const templateSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingTemplates);
    const data = templateSheet.getRange(2, 1, templateSheet.getLastRow() - 1, 4).getValues();
    
    const templateNames = new Set();
    
    data.forEach(row => {
      const templateName = row[0];
      const status = row[3];
      if (templateName && status === 'Active') {
        templateNames.add(templateName);
      }
    });
    
    return Array.from(templateNames).sort();
    
  } catch (err) {
    Logger.log("webGetActiveTemplates Error: " + err.message);
    return { error: err.message };
  }
}

/**
 * NEW: Gets all criteria for a specific template name.
 */
function webGetTemplateCriteria(templateName) {
  try {
    const ss = getSpreadsheet();
    const templateSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingTemplates);
    const data = templateSheet.getRange(2, 1, templateSheet.getLastRow() - 1, 4).getValues();
    
    const categories = {}; // Use an object to group criteria by category
    
    data.forEach(row => {
      const name = row[0];
      const category = row[1];
      const criteria = row[2];
      const status = row[3];
      
      if (name === templateName && status === 'Active' && category && criteria) {
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(criteria);
      }
    });
    
    // Convert from object to the array structure the frontend expects
    const results = Object.keys(categories).map(categoryName => {
      return {
        category: categoryName,
        criteria: categories[categoryName]
      };
    });
    
    return results;
    
  } catch (err) {
    Logger.log("webGetTemplateCriteria Error: " + err.message);
    return { error: err.message };
  }
}

// ==========================================================
// === NEW/REPLACED COACHING FUNCTIONS (END) ===
// ==========================================================

// [START] MODIFICATION 8: Add webSaveNewTemplate function
/**
 * NEW: Saves a new coaching template from the admin tab.
 */
function webSaveNewTemplate(templateName, categories) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    
    // Check permission
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    const adminRole = userData.emailToRole[adminEmail] || 'agent';

    if (adminRole !== 'admin' && adminRole !== 'superadmin') {
      throw new Error("Permission denied. Only managers can create templates.");
    }
    
    // Validation
    if (!templateName) {
      throw new Error("Template Name is required.");
    }
    if (!categories || categories.length === 0) {
      throw new Error("At least one category is required.");
    }

    const templateSheet = getOrCreateSheet(ss, SHEET_NAMES.coachingTemplates);
    
    // Check if template name already exists
    const templateNames = templateSheet.getRange(2, 1, templateSheet.getLastRow() - 1, 1).getValues();
    const
      lowerTemplateName = templateName.toLowerCase();
    for (let i = 0; i < templateNames.length; i++) {
      if (templateNames[i][0] && templateNames[i][0].toLowerCase() === lowerTemplateName) {
        throw new Error(`A template with the name '${templateName}' already exists.`);
      }
    }

    const rowsToAppend = [];
    categories.forEach(category => {
      if (category.criteria && category.criteria.length > 0) {
        category.criteria.forEach(criterion => {
          rowsToAppend.push([
            templateName,
            category.name,
            criterion,
            'Active' // Default to Active
          ]);
        });
      }
    });

    if (rowsToAppend.length === 0) {
      throw new Error("No criteria were found to save.");
    }
    
    // Write all new rows at once
    templateSheet.getRange(templateSheet.getLastRow() + 1, 1, rowsToAppend.length, 4).setValues(rowsToAppend);
    
    SpreadsheetApp.flush();
    return `Template '${templateName}' saved successfully with ${rowsToAppend.length} criteria.`;

  } catch (err) {
    Logger.log("webSaveNewTemplate Error: " + err.message);
    return "Error: " + err.message;
  }
}
// [END] MODIFICATION 8

// === NEW: Web App API for Manager Hierarchy ===
function webGetManagerHierarchy() {
  try {
    const managerEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    
    const managerRole = userData.emailToRole[managerEmail] || 'agent';
    if (managerRole === 'agent') {
      return { error: "Permission denied. Only managers can view the hierarchy." };
    }
    
    // --- Step 1: Build the direct reporting map (Supervisor -> [Subordinates]) ---
    const reportsMap = {};
    const userEmailMap = {}; // Map email -> {name, role}

    userData.userList.forEach(user => {
      userEmailMap[user.email] = { name: user.name, role: user.role };
      const supervisorEmail = user.supervisor;
      
      if (supervisorEmail) {
        if (!reportsMap[supervisorEmail]) {
          reportsMap[supervisorEmail] = [];
        }
        reportsMap[supervisorEmail].push(user.email);
      }
    });

    // --- Step 2: Recursive function to build the tree (Hierarchy) ---
    // MODIFIED: Added `visited` Set to track users in the current path.
    function buildHierarchy(currentEmail, depth = 0, visited = new Set()) {
      const user = userEmailMap[currentEmail];
      
      // If the email doesn't map to a user, it's likely a blank entry in the DB, so return null
      if (!user) return null; 
      
      // CRITICAL CHECK: Detect circular reference
      if (visited.has(currentEmail)) {
        Logger.log(`Circular reference detected at user: ${currentEmail}`);
        return {
          email: currentEmail,
          name: user.name,
          role: user.role,
          subordinates: [],
          circularError: true
        };
      }
      
      // Add current user to visited set for this path
      const newVisited = new Set(visited).add(currentEmail);


      const subordinates = reportsMap[currentEmail] || [];
      
      // Separate managers/admins from agents
      const adminSubordinates = subordinates
        .filter(email => userData.emailToRole[email] === 'admin' || userData.emailToRole[email] === 'superadmin')
        .map(email => buildHierarchy(email, depth + 1, newVisited))
        .filter(s => s !== null); // Build sub-teams for managers

      const agentSubordinates = subordinates
        .filter(email => userData.emailToRole[email] === 'agent')
        .map(email => ({
          email: email,
          name: userEmailMap[email].name,
          role: userEmailMap[email].role,
          subordinates: [] // Agents have no subordinates
        }));
        
      // Combine and sort: Managers first, then Agents, then alphabetically
      const combinedSubordinates = [...adminSubordinates, ...agentSubordinates];
      
      combinedSubordinates.sort((a, b) => {
          // Sort by role (manager/admin first)
          const aIsManager = a.role !== 'agent';
          const bIsManager = b.role !== 'agent';
          
          if (aIsManager && !bIsManager) return -1;
          if (!aIsManager && bIsManager) return 1;
          
          // Then sort by name
          return a.name.localeCompare(b.name);
      });


      return {
        email: currentEmail,
        name: user.name,
        role: user.role,
        subordinates: combinedSubordinates,
        depth: depth
      };
    }

    // Start building the hierarchy from the manager's email
    const hierarchy = buildHierarchy(managerEmail);
    
    // Check if the root node returned a circular error
    if (hierarchy && hierarchy.circularError) {
        throw new Error("Critical Error: Circular reporting line detected at the top level.");
    }

    return hierarchy;

  } catch (err) {
    Logger.log("webGetManagerHierarchy Error: " + err.message);
    throw new Error(err.message);
  }
}

// === NEW: Web App API to get all reports (flat list) ===
function webGetAllSubordinateEmails(managerEmail) {
    try {
        const ss = getSpreadsheet();
        const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
        const userData = getUserDataFromDb(dbSheet);
        
        const managerRole = userData.emailToRole[managerEmail] || 'agent';
        if (managerRole === 'agent') {
            throw new Error("Permission denied.");
        }
        
        // --- Build the direct reporting map ---
        const reportsMap = {};
        userData.userList.forEach(user => {
            const supervisorEmail = user.supervisor;
            if (supervisorEmail) {
                if (!reportsMap[supervisorEmail]) {
                    reportsMap[supervisorEmail] = [];
                }
                reportsMap[supervisorEmail].push(user.email);
            }
        });
        
        const allSubordinates = new Set();
        const queue = [managerEmail];
        
        // Use a set to track users we've already processed (including the manager him/herself)
        const processed = new Set();
        
        while (queue.length > 0) {
            const currentEmail = queue.shift();
            
            // Check for processing loop (shouldn't happen in BFS, but safe check)
            if (processed.has(currentEmail)) continue;
            processed.add(currentEmail);

            const directReports = reportsMap[currentEmail] || [];
            
            directReports.forEach(reportEmail => {
                if (!allSubordinates.has(reportEmail)) {
                    allSubordinates.add(reportEmail);
                    // If the report is a manager, add them to the queue to find their reports
                    if (userData.emailToRole[reportEmail] !== 'agent') {
                        queue.push(reportEmail); // <-- FIX: Was 'push(reportEmail)'
                    }
                }
            
        });
        }
        
        // Return all subordinates *plus* the manager
        allSubordinates.add(managerEmail);
        return Array.from(allSubordinates);

    } catch (err) {
        Logger.log("webGetAllSubordinateEmails Error: " + err.message);
        return [];
    }
}
// --- END OF WEB APP API SECTION ---


function getUserInfo() { 
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const timeZone = Session.getScriptTimeZone(); 
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
    let userData = getUserDataFromDb(ss);
    let isNewUser = false; 
    const KONECTA_DOMAIN = "@konecta.com"; 
    
    if (!userData.emailToName[userEmail] && userEmail.endsWith(KONECTA_DOMAIN)) {
      isNewUser = true;
      const nameParts = userEmail.split('@')[0].split('.');
      const firstName = nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : '';
      const lastName = nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : '';
      const newName = [firstName, lastName].join(' ').trim();
      const newEmpID = "KOM-PENDING-" + new Date().getTime();
      dbSheet.appendRow([newEmpID, newName || userEmail, userEmail, 'agent', 'Pending', "", "", 0, 0, 0, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Pending"]);
      SpreadsheetApp.flush(); 
      userData = getUserDataFromDb(ss);
    }
    
    const accountStatus = userData.emailToAccountStatus[userEmail] || 'Pending';
    const userName = userData.emailToName[userEmail] || "";
    const role = userData.emailToRole[userEmail] || 'agent';
    
    let currentStatus = null;
    if (accountStatus === 'Active') {
      const now = new Date();
      const shiftDate = getShiftDate(now, SHIFT_CUTOFF_HOUR);
      const formattedDate = Utilities.formatDate(shiftDate, timeZone, "MM/dd/yyyy");
      currentStatus = getLatestPunchStatus(userEmail, userName, shiftDate, formattedDate);
    }

    let allUsers = [];
    let allAdmins = [];
    if (role !== 'agent' || isNewUser || accountStatus === 'Pending') { 
      allUsers = userData.userList;
    }
    allAdmins = userData.userList.filter(u => u.role === 'admin' || u.role === 'superadmin' || u.role === 'manager');
    const myBalances = userData.emailToBalances[userEmail] || { annual: 0, sick: 0, casual: 0 };
    let hasPendingRoleRequests = false;
    if (role === 'superadmin') {
      const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.roleRequests);
      const data = reqSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) { if (data[i][7] === 'Pending') { hasPendingRoleRequests = true; break; } }
    }

    // --- GET PERMISSIONS ---
    const rbacMap = getPermissionsMap(ss);
    const myPermissions = [];
    for (const [perm, roles] of Object.entries(rbacMap)) {
      if (roles[role]) myPermissions.push(perm);
    }

    // --- NEW PHASE 3: GET BREAK CONFIGS ---
    const breakRules = {
      break1: getBreakConfig("First Break").default,
      lunch: getBreakConfig("Lunch").default,
      break2: getBreakConfig("Last Break").default,
      otPre: getBreakConfig("Overtime Pre-Shift").default, // Phase 8
      otPost: getBreakConfig("Overtime Post-Shift").default // Phase 8
    };

    return {
      name: userName, 
      email: userEmail,
      role: role,
      allUsers: allUsers,
      allAdmins: allAdmins,
      myBalances: myBalances,
      isNewUser: isNewUser, 
      accountStatus: accountStatus, 
      hasPendingRoleRequests: hasPendingRoleRequests, 
      currentStatus: currentStatus,
      permissions: myPermissions,
      breakRules: breakRules // <--- Sending to frontend
    };
  } catch (e) { throw new Error("Failed in getUserInfo: " + e.message); }
}


// ================= PUNCH MAIN FUNCTION (FIXED LOGIC) =================
function punch(action, targetUserName, puncherEmail, adminTimestamp) { 
  const ss = getSpreadsheet();
  const adherenceSheet = getOrCreateSheet(ss, SHEET_NAMES.adherence);
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  const otherCodesSheet = getOrCreateSheet(ss, SHEET_NAMES.otherCodes);
  const timeZone = Session.getScriptTimeZone(); 

  const userData = getUserDataFromDb(dbSheet);
  const puncherRole = userData.emailToRole[puncherEmail] || 'agent';
  const puncherIsAdmin = (puncherRole === 'admin' || puncherRole === 'superadmin');
  
  const userName = targetUserName; 
  const userEmail = userData.nameToEmail[userName];

  if (!puncherIsAdmin && puncherEmail !== userEmail) { 
    throw new Error("Permission denied. You can only submit punches for yourself.");
  }
  const isAdmin = puncherIsAdmin; 
  
  if (!userEmail) throw new Error(`User "${userName}" not found in Data Base.`);
  if (!userName && !puncherIsAdmin) throw new Error("Your email is not registered in the Data Base sheet.");
  
  const nowTimestamp = adminTimestamp ? new Date(adminTimestamp) : new Date();
  const shiftDate = getShiftDate(new Date(nowTimestamp), SHIFT_CUTOFF_HOUR);
  const formattedDate = Utilities.formatDate(shiftDate, timeZone, "MM/dd/yyyy");

  // === 4. HANDLE "OTHER CODES" ===
  const otherCodeActions = ["Meeting", "Personal", "Coaching"];
  for (const code of otherCodeActions) {
    if (action.startsWith(code)) {
      const resultMsg = logOtherCode(otherCodesSheet, userName, action, nowTimestamp, isAdmin && (puncherEmail !== userEmail || adminTimestamp) ? puncherEmail : null);
      logsSheet.appendRow([new Date(), userName, userEmail, action, nowTimestamp]); 
      return resultMsg;
    }
  }

  // === 5. PROCEED WITH ADHERENCE PUNCH ===
  const row = findOrCreateRow(adherenceSheet, userName, shiftDate, formattedDate); 
  const columns = { "Login": 3, "First Break In": 4, "First Break Out": 5, "Lunch In": 6, "Lunch Out": 7, "Last Break In": 8, "Last Break Out": 9, "Logout": 10 };
  const col = columns[action];
  if (!col) throw new Error("Invalid action: " + action);

  const isActionIn = (action === "Login" || action === "First Break In" || action === "Lunch In" || action === "Last Break In");
  const existingValue = adherenceSheet.getRange(row, col).getValue();
  
  // Strict double-punch check for "In" actions
  if (isActionIn && existingValue) throw new Error(`Error: "${action}" has already been punched today.`);

  const currentPunches = adherenceSheet.getRange(row, 3, 1, 8).getValues()[0];
  const punches = { login: currentPunches[0], firstBreakIn: currentPunches[1], firstBreakOut: currentPunches[2], lunchIn: currentPunches[3], lunchOut: currentPunches[4], lastBreakIn: currentPunches[5], lastBreakOut: currentPunches[6], logout: currentPunches[7] };

  if (!isAdmin) {
    if (action !== "Login" && !punches.login) throw new Error("You must 'Login' first.");
    const sequentialErrors = { "First Break Out": { required: punches.firstBreakIn, msg: "You must punch 'First Break In' first." }, "Lunch Out": { required: punches.lunchIn, msg: "You must punch 'Lunch In' first." }, "Last Break Out": { required: punches.lastBreakIn, msg: "You must punch 'Last Break In' first." } };
    if (sequentialErrors[action] && !sequentialErrors[action].required) throw new Error(sequentialErrors[action].msg);
    if (!isActionIn && existingValue) throw new Error(`"${action}" already punched today.`);
  }

  if (isAdmin && (puncherEmail !== userEmail || adminTimestamp)) { 
    adherenceSheet.getRange(row, 15).setValue("Yes"); 
    adherenceSheet.getRange(row, 21).setValue(puncherEmail); 
  }

  adherenceSheet.getRange(row, col).setValue(nowTimestamp);
  logsSheet.appendRow([new Date(), userName, userEmail, action, nowTimestamp]);

  // Update local punches for immediate calculation
  switch(action) {
    case "Login": punches.login = nowTimestamp; break;
    case "First Break In": punches.firstBreakIn = nowTimestamp; break;
    case "First Break Out": punches.firstBreakOut = nowTimestamp; break;
    case "Lunch In": punches.lunchIn = nowTimestamp; break;
    case "Lunch Out": punches.lunchOut = nowTimestamp; break;
    case "Last Break In": punches.lastBreakIn = nowTimestamp; break;
    case "Last Break Out": punches.lastBreakOut = nowTimestamp; break;
    case "Logout": punches.logout = nowTimestamp; break;
  }

  // === BREAK EXCEED CALCULATIONS ===
  try {
    let duration = 0, diff = 0;
    if (punches.firstBreakIn && punches.firstBreakOut) {
      duration = timeDiffInSeconds(punches.firstBreakIn, punches.firstBreakOut);
      diff = duration - getBreakConfig("First Break").default;
      adherenceSheet.getRange(row, 17).setValue((diff > 0) ? diff : "No"); // Col Q
    }
    if (punches.lunchIn && punches.lunchOut) {
      duration = timeDiffInSeconds(punches.lunchIn, punches.lunchOut);
      diff = duration - getBreakConfig("Lunch").default;
      adherenceSheet.getRange(row, 18).setValue((diff > 0) ? diff : "No"); // Col R
    }
    if (punches.lastBreakIn && punches.lastBreakOut) {
      duration = timeDiffInSeconds(punches.lastBreakIn, punches.lastBreakOut);
      diff = duration - getBreakConfig("Last Break").default;
      adherenceSheet.getRange(row, 19).setValue((diff > 0) ? diff : "No"); // Col S
    }
  } catch (e) { logsSheet.appendRow([new Date(), userName, userEmail, "Break Exceed Calc Error", e.message]); }

  // === SCHEDULE MATCHING & LEAVE TYPE ===
  const scheduleData = scheduleSheet.getDataRange().getValues();
  let shiftStartDateObj = null, shiftEndDateObj = null;
  let schedBreak1 = null, schedLunch = null, schedBreak2 = null;
  let scheduledLeaveType = "Present"; // Default to Present if punching

  for (let i = 1; i < scheduleData.length; i++) {
    const rowDat = scheduleData[i];
    // Trim and lower case comparison for safety
    const schEmail = String(rowDat[6]).trim().toLowerCase();
    
    // Check Email and Date match
    if (schEmail === userEmail && parseDate(rowDat[1])?.getTime() === shiftDate.getTime()) {
       
       // Found Schedule!
       scheduledLeaveType = rowDat[5] || "Present";
       
       if (rowDat[2]) shiftStartDateObj = createDateTime(new Date(rowDat[1]), Utilities.formatDate(rowDat[2], timeZone, "HH:mm:ss"));
       if (rowDat[4]) {
         const baseEndDate = rowDat[3] ? new Date(rowDat[3]) : new Date(rowDat[1]);
         shiftEndDateObj = createDateTime(baseEndDate, Utilities.formatDate(rowDat[4], timeZone, "HH:mm:ss"));
         // Handle overnight logic
         if(shiftStartDateObj && shiftEndDateObj && shiftEndDateObj < shiftStartDateObj) {
            shiftEndDateObj.setDate(shiftEndDateObj.getDate() + 1);
         }
       }
       
       // Windows
       const parseWindow = (t) => t ? createDateTime(new Date(rowDat[1]), Utilities.formatDate(t, timeZone, "HH:mm:ss")) : null;
       if (rowDat[7] && rowDat[8]) schedBreak1 = { start: parseWindow(rowDat[7]), end: parseWindow(rowDat[8]) };
       if (rowDat[9] && rowDat[10]) schedLunch = { start: parseWindow(rowDat[9]), end: parseWindow(rowDat[10]) };
       if (rowDat[11] && rowDat[12]) schedBreak2 = { start: parseWindow(rowDat[11]), end: parseWindow(rowDat[12]) };
       
       break; // Stop after finding the first matching schedule row
    }
  }

  // *** CRITICAL FIX 1: WRITE LEAVE TYPE ***
  // Ensure "Leave Type" (Column 14 / N) is populated
  adherenceSheet.getRange(row, 14).setValue(scheduledLeaveType);

  // Break Window Validation
  let violation = "No";
  const checkWindow = (t, w) => w ? (t < w.start || t > w.end) : false;
  if (action === "First Break In" && schedBreak1 && checkWindow(nowTimestamp, schedBreak1)) violation = "Yes";
  else if (action === "Lunch In" && schedLunch && checkWindow(nowTimestamp, schedLunch)) violation = "Yes";
  else if (action === "Last Break In" && schedBreak2 && checkWindow(nowTimestamp, schedBreak2)) violation = "Yes";
  
  if (violation === "Yes") adherenceSheet.getRange(row, 22).setValue("Yes");

  // === SHIFT METRICS (TARDY / EARLY / OT) ===
  // Only calculate if we successfully found a schedule and parsed start time
  if (shiftStartDateObj) {
    
    // 1. LOGIN Actions (Tardy & Pre-Shift Overtime)
    // Run this logic on Login, or if Tardy column is currently empty (retry)
    const currentTardy = adherenceSheet.getRange(row, 11).getValue();
    if (action === "Login" || (punches.login && (currentTardy === "" || currentTardy === 0))) {
       const loginTime = action === "Login" ? nowTimestamp : punches.login;
       const diff = timeDiffInSeconds(shiftStartDateObj, loginTime); // Positive = Tardy, Negative = Early
       
       if (diff > 0) {
         adherenceSheet.getRange(row, 11).setValue(diff); // Col K (11): Tardy
         adherenceSheet.getRange(row, 24).setValue(0);    // Clear Pre-Shift OT
       } else {
         adherenceSheet.getRange(row, 11).setValue(0);
         
         // *** CRITICAL FIX 2: Pre-Shift Overtime Calculation ***
         const earlySec = Math.abs(diff);
         const threshold = getBreakConfig("Overtime Pre-Shift").default;
         if (earlySec > threshold) {
           adherenceSheet.getRange(row, 24).setValue(earlySec); // Col X (24): Pre-Shift OT
         } else {
           adherenceSheet.getRange(row, 24).setValue(0);
         }
       }
    }
    
    // 2. LOGOUT Actions (Early Leave & Post-Shift Overtime)
    if ((action === "Logout" || punches.logout) && shiftEndDateObj) {
       const logoutTime = action === "Logout" ? nowTimestamp : punches.logout;
       const diff = timeDiffInSeconds(shiftEndDateObj, logoutTime); // Positive = Overtime, Negative = Early Leave
       
       if (diff > 0) {
         // Post-Shift Overtime
         const threshold = getBreakConfig("Overtime Post-Shift").default;
         if (diff > threshold) {
           adherenceSheet.getRange(row, 12).setValue(diff); // Col L (12): Overtime
         } else {
           adherenceSheet.getRange(row, 12).setValue(0);
         }
         adherenceSheet.getRange(row, 13).setValue(0); // Early Leave is 0
       } else {
         adherenceSheet.getRange(row, 12).setValue(0); // Overtime is 0
         adherenceSheet.getRange(row, 13).setValue(Math.abs(diff)); // Col M (13): Early Leave
       }
    }
  }

  // Net Login Hours
  if (action === "Logout" && punches.login) {
    const netHours = calculateNetHours(punches);
    adherenceSheet.getRange(row, 23).setValue(netHours); // Col W (23)
  }

  return `${userName}: ${action} recorded at ${Utilities.formatDate(nowTimestamp, timeZone, "HH:mm:ss")}`;
}


// REPLACE this function
// ================= SCHEDULE RANGE SUBMIT FUNCTION =================
function submitScheduleRange(puncherEmail, userEmail, userName, startDateStr, endDateStr, startTime, endTime, leaveType) {
  const ss = getSpreadsheet();
const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  const puncherRole = userData.emailToRole[puncherEmail] || 'agent';
  const timeZone = Session.getScriptTimeZone();
if (puncherRole !== 'admin' && puncherRole !== 'superadmin') {
    throw new Error("Permission denied. Only admins can submit schedules.");
}
  
  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
const userScheduleMap = {};
  for (let i = 1; i < scheduleData.length; i++) {
    // *** MODIFIED: Read Email from Col G (index 6) ***
    const rowEmail = scheduleData[i][6];
// *** MODIFIED: Read Date from Col B (index 1) ***
    const rowDateRaw = scheduleData[i][1];
if (rowEmail && rowDateRaw && rowEmail.toLowerCase() === userEmail) {
      const rowDate = new Date(rowDateRaw);
const rowDateStr = Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy");
      userScheduleMap[rowDateStr] = i + 1;
}
  }
  
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
let currentDate = new Date(startDate);
  let daysProcessed = 0;
  let daysUpdated = 0;
  let daysCreated = 0;
const oneDayInMs = 24 * 60 * 60 * 1000;
  
  currentDate = new Date(currentDate.valueOf() + currentDate.getTimezoneOffset() * 60000);
const finalDate = new Date(endDate.valueOf() + endDate.getTimezoneOffset() * 60000);
  
  while (currentDate <= finalDate) {
    const currentDateStr = Utilities.formatDate(currentDate, timeZone, "MM/dd/yyyy");
// *** NEW: Auto-calculate shift end date for overnight shifts ***
    let shiftEndDate = new Date(currentDate);
// Start with the same date
    if (startTime && endTime) {
      const startDateTime = createDateTime(currentDate, startTime);
const endDateTime = createDateTime(currentDate, endTime);
      if (endDateTime <= startDateTime) {
        shiftEndDate.setDate(shiftEndDate.getDate() + 1);
// It's the next day
      }
    }
    // *** END NEW ***

    const result = updateOrAddSingleSchedule(
      scheduleSheet, userScheduleMap, logsSheet,
      userEmail, userName, 
      currentDate, // This is StartDate (Col B)
      shiftEndDate, // *** NEW: This is EndDate (Col D) ***
      currentDateStr, 
      startTime, endTime, leaveType, puncherEmail
    );
if (result === "UPDATED") daysUpdated++;
    if (result === "CREATED") daysCreated++;
    
    daysProcessed++;
    currentDate.setTime(currentDate.getTime() + oneDayInMs);
}
  
  if (daysProcessed === 0) {
    throw new Error("No dates were processed. Check date range.");
}
  
  return `Schedule submission complete for ${userName}. Days processed: ${daysProcessed} (Updated: ${daysUpdated}, Created: ${daysCreated}).`;
}

// Helper for Import & Manual Submit (PHASE 9 UPDATED)
function updateOrAddSingleSchedule(
  scheduleSheet, userScheduleMap, logsSheet, 
  userEmail, userName, shiftStartDate, shiftEndDate, targetDateStr, 
  startTime, endTime, leaveType, puncherEmail,
  // New Optional Args
  b1s = "", b1e = "", ls = "", le = "", b2s = "", b2e = ""
) {
  
  const existingRow = userScheduleMap[targetDateStr];
  let startTimeObj = startTime ? new Date(`1899-12-30T${startTime}`) : "";
  let endTimeObj = endTime ? new Date(`1899-12-30T${endTime}`) : "";
  let endDateObj = (leaveType === 'Present' && endTimeObj) ? shiftEndDate : "";

  // Convert break strings to Date objects if they exist
  const toDateObj = (t) => t ? new Date(`1899-12-30T${t}`) : "";
  
  // --- PHASE 9: Write 13 Columns ---
  const rowData = [[
    userName,       // A
    shiftStartDate, // B
    startTimeObj,   // C
    endDateObj,     // D
    endTimeObj,     // E
    leaveType,      // F
    userEmail,      // G
    toDateObj(b1s), // H (Break1 Start)
    toDateObj(b1e), // I (Break1 End)
    toDateObj(ls),  // J (Lunch Start)
    toDateObj(le),  // K (Lunch End)
    toDateObj(b2s), // L (Break2 Start)
    toDateObj(b2e)  // M (Break2 End)
  ]];

  if (existingRow) {
    scheduleSheet.getRange(existingRow, 1, 1, 13).setValues(rowData);
    logsSheet.appendRow([new Date(), userName, puncherEmail, "Schedule UPDATE", `Set to: ${leaveType}`]);
    return "UPDATED";
  } else {
    scheduleSheet.appendRow(rowData[0]);
    logsSheet.appendRow([new Date(), userName, puncherEmail, "Schedule CREATE", `Set to: ${leaveType}`]);
    return "CREATED";
  }
}

// ================= HELPER FUNCTIONS =================

function getShiftDate(dateObj, cutoffHour) {
  if (dateObj.getHours() < cutoffHour) {
    dateObj.setDate(dateObj.getDate() - 1);
  }
  return dateObj;
}

function createDateTime(dateObj, timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  
  const [hours, minutes, seconds] = parts.map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null; 

  const newDate = new Date(dateObj);
  newDate.setHours(hours, minutes, seconds || 0, 0);
  return newDate;
}

// [code.gs] REPLACE your existing getUserDataFromDb with this:

function getUserDataFromDb(ss) {
  if (!ss || !ss.getSheetByName) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const coreSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII); 

  const coreData = coreSheet.getDataRange().getValues();
  const piiData = piiSheet.getDataRange().getValues();

  const piiMap = {};
  for (let i = 1; i < piiData.length; i++) {
    const empID = piiData[i][0];
    piiMap[empID] = { hiringDate: piiData[i][1] };
  }

  const nameToEmail = {};
  const emailToName = {};
  const emailToRole = {};
  const emailToBalances = {};
  const emailToRow = {};
  const emailToSupervisor = {};
  const emailToProjectManager = {}; 
  const emailToAccountStatus = {};
  const emailToHiringDate = {};
  const userList = [];

  // Map Headers Dynamically
  const headers = coreData[0];
  const colIdx = {};
  headers.forEach((header, index) => { colIdx[header] = index; });

  const defaultDirectMgrIdx = 5; 

  for (let i = 1; i < coreData.length; i++) {
    try {
      const row = coreData[i];
      const empID = row[colIdx["EmployeeID"] || 0];
      const name = row[colIdx["Name"] || 1];
      const email = row[colIdx["Email"] || 2];

      if (name && email) {
        const cleanName = name.toString().trim();
        const cleanEmail = email.toString().trim().toLowerCase();
        const userRole = (row[colIdx["Role"] || 3] || 'agent').toString().trim().toLowerCase();
        const accountStatus = (row[colIdx["AccountStatus"] || 4] || "Pending").toString().trim();
        
        // --- MANAGER FETCHING (Removed Functional) ---
        let dmIdx = colIdx["DirectManagerEmail"];
        if (dmIdx === undefined) dmIdx = colIdx["DirectManager"]; 
        if (dmIdx === undefined) dmIdx = defaultDirectMgrIdx;

        let pmIdx = colIdx["ProjectManagerEmail"];
        if (pmIdx === undefined) pmIdx = colIdx["ProjectManager"];

        let dotIdx = colIdx["DottedManager"];

        const directMgr = (row[dmIdx] || "").toString().trim().toLowerCase();
        const projectMgr = (pmIdx !== undefined ? row[pmIdx] : "").toString().trim().toLowerCase();
        const dottedMgr = (dotIdx !== undefined ? row[dotIdx] : "").toString().trim().toLowerCase();
        // ---------------------------------------------

        const pii = piiMap[empID] || {};
        const hiringDateStr = convertDateToString(parseDate(pii.hiringDate));

        nameToEmail[cleanName] = cleanEmail;
        emailToName[cleanEmail] = cleanName;
        emailToRole[cleanEmail] = userRole;
        emailToRow[cleanEmail] = i + 1;
        
        emailToSupervisor[cleanEmail] = directMgr;
        emailToProjectManager[cleanEmail] = projectMgr;
        
        emailToAccountStatus[cleanEmail] = accountStatus;
        emailToHiringDate[cleanEmail] = hiringDateStr;

        emailToBalances[cleanEmail] = {
          annual: parseFloat(row[colIdx["AnnualBalance"] || 7]) || 0,
          sick: parseFloat(row[colIdx["SickBalance"] || 8]) || 0,
          casual: parseFloat(row[colIdx["CasualBalance"] || 9]) || 0
        };

        userList.push({
          empID: empID,
          name: cleanName,
          email: cleanEmail,
          role: userRole,
          balances: emailToBalances[cleanEmail],
          supervisor: directMgr,
          projectManager: projectMgr,
          dottedManager: dottedMgr,
          accountStatus: accountStatus,
          hiringDate: hiringDateStr
        });
      }
    } catch (e) {
      Logger.log(`Error processing user row ${i}: ${e.message}`);
    }
  }

  return {
    nameToEmail, emailToName, emailToRole, emailToBalances,
    emailToRow, emailToSupervisor, emailToProjectManager,
    emailToAccountStatus, emailToHiringDate, userList
  };
}


/**
 * NEW: Finds the latest adherence or other code punch for a user 
 * on a given shift date and determines their current logical status.
 * UPDATED PHASE 1: Now returns schedule info for the frontend.
 */
function getLatestPunchStatus(userEmail, userName, shiftDate, formattedDate) {
  const ss = getSpreadsheet();
  const adherenceSheet = getOrCreateSheet(ss, SHEET_NAMES.adherence);
  const otherCodesSheet = getOrCreateSheet(ss, SHEET_NAMES.otherCodes);
  
  let lastAdherencePunch = null;
  let lastAdherenceTime = new Date(0);
  let lastOtherPunch = null;
  let lastOtherTime = new Date(0);

  // 1. Check Adherence Tracker
  const adherenceData = adherenceSheet.getDataRange().getValues();
  for (let i = adherenceData.length - 1; i > 0; i--) {
    const row = adherenceData[i];
    if (row[1] === userName && Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), "MM/dd/yyyy") === formattedDate) {
      const punches = [
        { name: "Login", time: row[2] },
        { name: "First Break In", time: row[3] },
        { name: "First Break Out", time: row[4] },
        { name: "Lunch In", time: row[5] },
        { name: "Lunch Out", time: row[6] },
        { name: "Last Break In", time: row[7] },
        { name: "Last Break Out", time: row[8] },
        { name: "Logout", time: row[9] }
      ];
      for (const punch of punches) {
        if (punch.time instanceof Date && punch.time > lastAdherenceTime) {
          lastAdherenceTime = punch.time;
          lastAdherencePunch = punch.name;
        }
      }
      break;
    }
  }

  // 2. Check Other Codes
  const otherCodesData = otherCodesSheet.getDataRange().getValues();
  for (let i = otherCodesData.length - 1; i > 0; i--) {
    const row = otherCodesData[i];
    const rowShiftDate = getShiftDate(new Date(row[0]), SHIFT_CUTOFF_HOUR);
    if (row[1] === userName && Utilities.formatDate(rowShiftDate, Session.getScriptTimeZone(), "MM/dd/yyyy") === formattedDate) {
      const timeIn = row[3];
      const timeOut = row[4];
      const code = row[2];

      if (timeIn instanceof Date && timeIn > lastOtherTime) {
        lastOtherTime = timeIn;
        lastOtherPunch = `${code} In`;
      }
      if (timeOut instanceof Date && timeOut > lastOtherTime) {
        lastOtherTime = timeOut;
        lastOtherPunch = `${code} Out`;
      }
    }
  }

  // 3. Compare and determine final status
  let lastPunchName = null;
  let lastPunchTime = null;

  if (lastAdherenceTime > lastOtherTime) {
    lastPunchName = lastAdherencePunch;
    lastPunchTime = lastAdherenceTime;
  } else {
    lastPunchName = lastOtherPunch;
    lastPunchTime = lastOtherTime;
  }

  // Get Schedule Info regardless of punch status
  const scheduleInfo = getScheduleForDate(userEmail, shiftDate);

  if (!lastPunchName) {
    return { status: "Logged Out", time: null, schedule: scheduleInfo };
  }

  // 4. Determine logical *current* status
  let currentStatus = "Logged Out";
  if (lastPunchName.endsWith(" In")) {
    // Handle "Login" specifically, others are "On X"
    if (lastPunchName === "Login") {
       currentStatus = "Logged In";
    } else {
       // e.g., "First Break In" -> "On First Break", "Meeting In" -> "On Meeting"
       currentStatus = "On " + lastPunchName.replace(" In", "");
    }
  } else if (lastPunchName.endsWith(" Out") && lastPunchName !== "Logout") {
    currentStatus = "Logged In";
  } else if (lastPunchName === "Logout") {
    currentStatus = "Logged Out";
  }

  return {
    status: currentStatus,
    time: convertDateToString(lastPunchTime),
    schedule: scheduleInfo
  };
}

/**
 * UPDATED PHASE 1: Helper to fetch schedule start/end for a specific date.
 * Handles overnight shifts logic correctly.
 */
function getScheduleForDate(userEmail, dateObj) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const data = sheet.getDataRange().getValues();
  const timeZone = Session.getScriptTimeZone();
  const targetDateStr = Utilities.formatDate(dateObj, timeZone, "MM/dd/yyyy");
  
  // Iterate backwards to find the most recent matching schedule entry
  for (let i = data.length - 1; i > 0; i--) {
    // Col 7 (Index 6) is email, Col 2 (Index 1) is Date
    if (String(data[i][6]).toLowerCase() === userEmail.toLowerCase()) {
      const rowDate = data[i][1];
      
      // Check if this row matches our target date
      // Note: parseDate is robust, but direct comparison of strings is safer for exact dates
      let rowDateStr = "";
      if (rowDate instanceof Date) {
        rowDateStr = Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy");
      } else {
        // Try parsing if string
        const pDate = parseDate(rowDate);
        if (pDate) rowDateStr = Utilities.formatDate(pDate, timeZone, "MM/dd/yyyy");
      }

      if (rowDateStr === targetDateStr) {
        let startTime = data[i][2]; // Col C
        let endTime = data[i][4];   // Col E
        
        // Construct full DateTime objects
        let startDateTime = null;
        let endDateTime = null;

        if (startTime) {
           // Handle if time is already a Date object (from Sheets) or string
           const timeStr = (startTime instanceof Date) ? 
             Utilities.formatDate(startTime, timeZone, "HH:mm:ss") : startTime;
           startDateTime = createDateTime(dateObj, timeStr);
        }

        if (endTime) {
           const timeStr = (endTime instanceof Date) ? 
             Utilities.formatDate(endTime, timeZone, "HH:mm:ss") : endTime;
           
           // Base end date is the same day
           let baseEndDate = new Date(dateObj);
           endDateTime = createDateTime(baseEndDate, timeStr);
           
           // Overnight check: If End Time is earlier than Start Time, it ends the next day
           // Or if explicit EndDate (Col D) is different (not handled here for simplicity, relying on time logic)
           if (startDateTime && endDateTime && endDateTime < startDateTime) {
             endDateTime.setDate(endDateTime.getDate() + 1);
           }
        }

        return {
          start: convertDateToString(startDateTime),
          end: convertDateToString(endDateTime)
        };
      }
    }
  }
  return null;
}

/**
 * NEW PHASE 3: Reads break configuration from the sheet.
 * Returns an object with default and max duration in seconds.
 */
function getBreakConfig(breakType, projectId) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.breakConfig);
  const data = sheet.getDataRange().getValues();
  
  // Default fallbacks if sheet is empty or row missing
  let config = { default: 900, max: 1200 }; // 15 min / 20 min default
  if (breakType === "Lunch") config = { default: 1800, max: 2400 }; // 30 min / 40 min
  
  for (let i = 1; i < data.length; i++) {
    // Col A: Type, Col B: Default, Col C: Max, Col D: Project
    const rowType = data[i][0];
    const rowProject = data[i][3] || "ALL";
    
    if (rowType === breakType) {
      // Simplistic logic: specific project overrides ALL, but here we just take the first match or 'ALL'
      // For Phase 3, we assume global rules (Project = ALL)
      config.default = Number(data[i][1]);
      config.max = Number(data[i][2]);
      break;
    }
  }
  return config;
}

// REPLACE this function in your code.gs file
function logOtherCode(sheet, userName, action, nowTimestamp, adminEmail) { 
  const [code, type] = action.split(" ");
  const data = sheet.getDataRange().getValues();
  const timeZone = Session.getScriptTimeZone();
  
  const shiftDate = getShiftDate(new Date(nowTimestamp), SHIFT_CUTOFF_HOUR);
  const dateStr = Utilities.formatDate(shiftDate, timeZone, "MM/dd/yyyy");

  if (type === "In") {
    
    // --- START: MODIFICATION FOR REQUEST 1 (Prevent Double "In" Punch for Other Codes) ---
    // This check applies to EVERYONE, including admins using the main punch button.
    let alreadyPunchedIn = false;
    for (let i = data.length - 1; i > 0; i--) {
        const [rowDateRaw, rowName, rowCode, rowIn] = data[i];
        if (!rowDateRaw || !rowName || !rowIn) continue; // Skip rows without an "In" punch
        
        const rowShiftDate = getShiftDate(new Date(rowDateRaw), SHIFT_CUTOFF_HOUR);
        const rowDateStr = Utilities.formatDate(rowShiftDate, timeZone, "MM/dd/yyyy");

        if (rowName === userName && rowDateStr === dateStr && rowCode === code) {
            // Found an "In" punch for this code, user, and date.
            alreadyPunchedIn = true;
            break;
        }
    }
    if (alreadyPunchedIn) {
        throw new Error(`Error: "${action}" has already been punched today.`);
    }
    // --- END: MODIFICATION FOR REQUEST 1 ---

    if (adminEmail) { 
       sheet.appendRow([nowTimestamp, userName, code, nowTimestamp, "", "", adminEmail]);
       return `${userName}: ${action} recorded at ${Utilities.formatDate(nowTimestamp, timeZone, "HH:mm:ss")}.`;
    }
    
    // This loop now only checks for sequential errors (In without Out) for non-admins
    for (let i = data.length - 1; i > 0; i--) {
      const [rowDateRaw, rowName, rowCode, rowIn, rowOut] = data[i];
      if (!rowDateRaw || !rowName) continue;
      
      const rowShiftDate = getShiftDate(new Date(rowDateRaw), SHIFT_CUTOFF_HOUR);
      const rowDateStr = Utilities.formatDate(rowShiftDate, timeZone, "MM/dd/yyyy");
      if (rowName === userName && rowDateStr === dateStr && rowCode === code && rowIn && !rowOut) { 
        throw new Error(`You must punch "${code} Out" before punching "In" again.`);
      }
    }
    sheet.appendRow([nowTimestamp, userName, code, nowTimestamp, "", "", adminEmail || ""]);

  } else if (type === "Out") {
    let matchingInPunch = null;
    let matchingInRow = -1;
    for (let i = data.length - 1; i > 0; i--) {
      const [rowDateRaw, rowName, rowCode, rowIn, rowOut] = data[i];
      if (!rowDateRaw || !rowName || !rowIn) continue;
      
      const rowShiftDate = getShiftDate(new Date(rowDateRaw), SHIFT_CUTOFF_HOUR);
      const rowDateStr = Utilities.formatDate(rowShiftDate, timeZone, "MM/dd/yyyy");
      if (rowName === userName && rowDateStr === dateStr && rowCode === code && rowIn && !rowOut) { 
        matchingInPunch = rowIn; // This is a Date object
        matchingInRow = i + 1;
        break;
      }
    }
    
    if (matchingInPunch) {
      const duration = timeDiffInSeconds(matchingInPunch, nowTimestamp);
      sheet.getRange(matchingInRow, 5).setValue(nowTimestamp);
      sheet.getRange(matchingInRow, 6).setValue(duration);
      if (adminEmail) {
        sheet.getRange(matchingInRow, 7).setValue(adminEmail);
      }
      return `${userName}: ${action} recorded. Duration: ${Math.round(duration/60)} mins.`;
    } else {
      if (adminEmail) { 
        sheet.appendRow([nowTimestamp, userName, code, "", nowTimestamp, 0, adminEmail]);
        return `${userName}: ${action} (Out) recorded without matching In.`;
      }
      throw new Error(`You must punch "${code} In" first.`);
    }
  }
  return `${userName}: ${action} recorded at ${Utilities.formatDate(nowTimestamp, timeZone, "HH:mm:ss")}.`; 
}

// (No Change)
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// (No Change)
function findOrCreateRow(sheet, userName, shiftDate, formattedDate) { 
  const data = sheet.getDataRange().getValues();
  const timeZone = Session.getScriptTimeZone();
  let row = -1;
  for (let i = 1; i < data.length; i++) {
    const rowDate = new Date(data[i][0]);
    const rowUser = data[i][1]; 
    if (
      rowUser && 
      rowUser.toString().toLowerCase() === userName.toLowerCase() && 
      Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy") === formattedDate
    ) {
      row = i + 1;
      break;
    }
  }

  if (row === -1) {
    row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1).setValue(shiftDate);
    sheet.getRange(row, 2).setValue(userName); 
  }
  return row;
}

function getOrCreateSheet(ss, name) {
  if (!name) return null;
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    
    if (name === SHEET_NAMES.employeesCore) {
      sheet.getRange("A1:J1").setValues([["EmployeeID", "Name", "Email", "Role", "AccountStatus", "DirectManagerEmail", "FunctionalManagerEmail", "AnnualBalance", "SickBalance", "CasualBalance"]]);
      sheet.setFrozenRows(1);
    } 
    else if (name === SHEET_NAMES.employeesPII) {
      sheet.getRange("A1:H1").setValues([["EmployeeID", "HiringDate", "Salary", "IBAN", "Address", "Phone", "MedicalInfo", "ContractType"]]);
      sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd");
      sheet.setFrozenRows(1);
    }
    // --- PHASE 8 UPDATE: Added Overtime Rules ---
    else if (name === SHEET_NAMES.breakConfig) {
      sheet.getRange("A1:D1").setValues([["BreakType", "DefaultDuration (Sec)", "MaxDuration (Sec)", "ProjectID"]]);
      sheet.getRange("A2:D6").setValues([
        ["First Break", 900, 1200, "ALL"], 
        ["Lunch", 1800, 2400, "ALL"],      
        ["Last Break", 900, 1200, "ALL"],
        ["Overtime Pre-Shift", 300, 0, "ALL"],  // 5 mins threshold
        ["Overtime Post-Shift", 300, 0, "ALL"]  // 5 mins threshold
      ]);
      sheet.setFrozenRows(1);
    }
    else if (name === SHEET_NAMES.assets) {
      sheet.getRange("A1:E1").setValues([["AssetID", "Type", "AssignedTo_EmployeeID", "DateAssigned", "Status"]]);
      sheet.setFrozenRows(1);
    }
    else if (name === SHEET_NAMES.projects) {
      sheet.getRange("A1:D1").setValues([["ProjectID", "ProjectName", "ProjectManagerEmail", "AllowedRoles"]]);
      sheet.setFrozenRows(1);
    }
    else if (name === SHEET_NAMES.projectLogs) {
      sheet.getRange("A1:E1").setValues([["LogID", "EmployeeID", "ProjectID", "Date", "HoursLogged"]]);
      sheet.setFrozenRows(1);
    }
    else if (name === SHEET_NAMES.warnings) {
      sheet.getRange("A1:H1").setValues([["WarningID", "EmployeeID", "Type", "Level", "Date", "Description", "Status", "IssuedBy"]]);
      sheet.setFrozenRows(1);
    }
    else if (name === SHEET_NAMES.schedule) {
      sheet.getRange("A1:M1").setValues([["Name", "StartDate", "ShiftStartTime", "EndDate", "ShiftEndTime", "LeaveType", "agent email", "Break1_Start", "Break1_End", "Lunch_Start", "Lunch_End", "Break2_Start", "Break2_End"]]);
      sheet.getRange("B:B").setNumberFormat("mm/dd/yyyy");
      sheet.getRange("C:C").setNumberFormat("hh:mm");
      sheet.getRange("D:D").setNumberFormat("mm/dd/yyyy");
      sheet.getRange("E:E").setNumberFormat("hh:mm");
      sheet.getRange("H:M").setNumberFormat("hh:mm");
    } 
    // --- PHASE 8 UPDATE: Added PreShiftOvertime Column (Col X / 24) ---
    else if (name === SHEET_NAMES.adherence) {
      sheet.getRange("A1:X1").setValues([["Date", "User Name", "Login", "First Break In", "First Break Out", "Lunch In", "Lunch Out", "Last Break In", "Last Break Out", "Logout", "Tardy (Seconds)", "Overtime (Seconds)", "Early Leave (Seconds)", "Leave Type", "Admin Audit", "—", "1st Break Exceed", "Lunch Exceed", "Last Break Exceed", "Absent", "Admin Code", "BreakWindowViolation", "NetLoginHours", "PreShiftOvertime"]]);
      sheet.getRange("C:J").setNumberFormat("hh:mm:ss");
    } 
    else if (name === SHEET_NAMES.logs) {
      sheet.getRange("A1:E1").setValues([["Timestamp", "User Name", "Email", "Action", "Time"]]);
    } 
    else if (name === SHEET_NAMES.otherCodes) { 
      sheet.getRange("A1:G1").setValues([["Date", "User Name", "Code", "Time In", "Time Out", "Duration (Seconds)", "Admin Audit (Email)"]]);
      sheet.getRange("D:E").setNumberFormat("hh:mm:ss");
    } 
    else if (name === SHEET_NAMES.leaveRequests) { 
      sheet.getRange("A1:N1").setValues([["RequestID", "Status", "RequestedByEmail", "RequestedByName", "LeaveType", "StartDate", "EndDate", "TotalDays", "Reason", "ActionDate", "ActionBy", "SupervisorEmail", "ActionReason", "SickNoteURL"]]);
      sheet.getRange("F:G").setNumberFormat("mm/dd/yyyy");
      sheet.getRange("J:J").setNumberFormat("mm/dd/yyyy");
    } 
    else if (name === SHEET_NAMES.coachingSessions) { 
      sheet.getRange("A1:M1").setValues([["SessionID", "AgentEmail", "AgentName", "CoachEmail", "CoachName", "SessionDate", "WeekNumber", "OverallScore", "FollowUpComment", "SubmissionTimestamp", "FollowUpDate", "FollowUpStatus", "AgentAcknowledgementTimestamp"]]);
      sheet.getRange("F:F").setNumberFormat("mm/dd/yyyy");
      sheet.getRange("J:J").setNumberFormat("mm/dd/yyyy hh:mm:ss");
      sheet.getRange("K:K").setNumberFormat("mm/dd/yyyy");
      sheet.getRange("M:M").setNumberFormat("mm/dd/yyyy hh:mm:ss");
    } 
    else if (name === SHEET_NAMES.coachingScores) { 
      sheet.getRange("A1:E1").setValues([["SessionID", "Category", "Criteria", "Score", "Comment"]]);
    } 
    else if (name === SHEET_NAMES.coachingTemplates) {
      sheet.getRange("A1:D1").setValues([["TemplateName", "Category", "Criteria", "Status"]]);
      sheet.setFrozenRows(1);
    }
    else if (name === SHEET_NAMES.pendingRegistrations) {
      sheet.getRange("A1:J1").setValues([["RequestID", "UserEmail", "UserName", "DirectManagerEmail", "FunctionalManagerEmail", "DirectStatus", "FunctionalStatus", "Address", "Phone", "RequestTimestamp"]]);
      sheet.setFrozenRows(1);
      sheet.getRange("J:J").setNumberFormat("mm/dd/yyyy hh:mm:ss");
    }
    else if (name === SHEET_NAMES.movementRequests) {
      sheet.getRange("A1:J1").setValues([["MovementID", "Status", "UserToMoveEmail", "UserToMoveName", "FromSupervisorEmail", "ToSupervisorEmail", "RequestTimestamp", "ActionTimestamp", "ActionByEmail", "RequestedByEmail"]]);
      sheet.getRange("G:H").setNumberFormat("mm/dd/yyyy hh:mm:ss");
    }
    else if (name === SHEET_NAMES.announcements) {
      sheet.getRange("A1:E1").setValues([["AnnouncementID", "Content", "Status", "CreatedByEmail", "Timestamp"]]);
      sheet.getRange("E:E").setNumberFormat("mm/dd/yyyy hh:mm:ss");
    }
    else if (name === SHEET_NAMES.roleRequests) {
      sheet.getRange("A1:J1").setValues([["RequestID", "UserEmail", "UserName", "CurrentRole", "RequestedRole", "Justification", "RequestTimestamp", "Status", "ActionByEmail", "ActionTimestamp"]]);
      sheet.getRange("G:G").setNumberFormat("mm/dd/yyyy hh:mm:ss");
      sheet.getRange("J:J").setNumberFormat("mm/dd/yyyy hh:mm:ss");
    }
  }

  if (name === SHEET_NAMES.adherence) sheet.getRange("C:J").setNumberFormat("hh:mm:ss");
  if (name === SHEET_NAMES.otherCodes) sheet.getRange("D:E").setNumberFormat("hh:mm:ss");
  if (name === SHEET_NAMES.employeesPII) sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd");
  if (name === SHEET_NAMES.schedule) sheet.getRange("H:M").setNumberFormat("hh:mm");

  return sheet;
}

// (No Change)
function timeDiffInSeconds(start, end) {
  if (!start || !end || !(start instanceof Date) || !(end instanceof Date)) {
    return 0;
  }
  return Math.round((end.getTime() - start.getTime()) / 1000);
}


// ================= DAILY AUTO-LOG FUNCTION =================
function dailyLeaveSweeper() {
  const ss = getSpreadsheet();
  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const adherenceSheet = getOrCreateSheet(ss, SHEET_NAMES.adherence);
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  const timeZone = Session.getScriptTimeZone();
  // 1. Define the 7-day lookback period
  const lookbackDays = 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(today); // Today
  endDate.setDate(endDate.getDate() - 1); // End date is yesterday

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (lookbackDays - 1)); // Start date is 7 days ago

  const startDateStr = Utilities.formatDate(startDate, timeZone, "MM/dd/yyyy");
  const endDateStr = Utilities.formatDate(endDate, timeZone, "MM/dd/yyyy");

  Logger.log(`Starting dailyLeaveSweeper for date range: ${startDateStr} to ${endDateStr}`);
  // 2. Get all Adherence rows for the past 7 days and create a lookup Set
  const allAdherence = adherenceSheet.getDataRange().getValues();
  const adherenceLookup = new Set();
  for (let i = 1; i < allAdherence.length; i++) {
    try {
      const rowDate = new Date(allAdherence[i][0]);
      if (rowDate >= startDate && rowDate <= endDate) {
        const rowDateStr = Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy");
        const userName = allAdherence[i][1].toString().trim().toLowerCase();
        adherenceLookup.add(`${userName}:${rowDateStr}`);
      }
    } catch (e) {
      Logger.log(`Skipping adherence row ${i+1}: ${e.message}`);
    }
  }
  Logger.log(`Found ${adherenceLookup.size} existing adherence records in the date range.`);
  // 3. Get all Schedules and loop through them
  const allSchedules = scheduleSheet.getDataRange().getValues();
  let missedLogs = 0;
  for (let i = 1; i < allSchedules.length; i++) {
    try {
      // *** THIS LINE IS THE FIX ***
      // It now correctly reads all 7 columns, matching your sheet structure.
      const [schName, schDate, schStart, schEndDate, schEndTime, schLeave, schEmail] = allSchedules[i];
      // *** END OF FIX ***

      const leaveType = (schLeave || "").toString().trim(); // schLeave is now correctly column F (index 5)

      // This logic is now correct because schLeave and schEmail are from the right columns
      if (leaveType === "" || !schName || !schEmail) {
        continue;
      }

     const schDateObj = parseDate(schDate);

      if (schDateObj && schDateObj >= startDate && schDateObj <= endDate) {
        const schDateStr = Utilities.formatDate(schDateObj, timeZone, "MM/dd/yyyy");
        const userName = schName.toString().trim();
        const userNameLower = userName.toLowerCase();

        const lookupKey = `${userNameLower}:${schDateStr}`;
        // 4. Check if this user is *already* in the Adherence sheet
        if (adherenceLookup.has(lookupKey)) {
          continue; // We found them, so skip
        }

        // 5. We found a missed user!
        Logger.log(`Found missed user: ${userName} for ${schDateStr}. Logging: ${leaveType}`);

        const row = findOrCreateRow(adherenceSheet, userName, schDateObj, schDateStr);
        // *** MODIFIED for Request 3: Mark "Present" as "Absent" ***
        if (leaveType.toLowerCase() === "present") {
          adherenceSheet.getRange(row, 14).setValue("Absent"); // Set Leave Type to Absent
          adherenceSheet.getRange(row, 20).setValue("Yes"); // Set Absent flag to Yes (Col T)
          logsSheet.appendRow([new Date(), userName, schEmail, "Auto-Log Absent", "User was 'Present' but did not punch in."]);
        } else {
          adherenceSheet.getRange(row, 14).setValue(leaveType); // Log Sick, Annual, etc.
          if (leaveType.toLowerCase() === "absent") {
            adherenceSheet.getRange(row, 20).setValue("Yes"); // Set Absent flag (Col T)
          }
          logsSheet.appendRow([new Date(), userName, schEmail, "Auto-Log Leave", leaveType]);
        }

        missedLogs++;
        adherenceLookup.add(lookupKey); // Add to lookup so we don't process again
      }
    } catch (e) {
      Logger.log(`Skipping schedule row ${i+1}: ${e.message}`);
    }
  }

  Logger.log(`dailyLeaveSweeper finished. Logged ${missedLogs} missed users.`);
}

// ================= LEAVE REQUEST FUNCTIONS =================

// (Helper - No Change)
function convertDateToString(dateObj) {
  if (dateObj instanceof Date && !isNaN(dateObj)) {
    return dateObj.toISOString(); // "2025-11-06T18:30:00.000Z"
  }
  return null; // Return null if it's not a valid date
}

// (No Change)
function getMyRequests(userEmail) {
  const ss = getSpreadsheet();
  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.leaveRequests);
  const allData = reqSheet.getDataRange().getValues();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  
  const myRequests = [];
  
  // Loop backwards (newest first)
  for (let i = allData.length - 1; i > 0; i--) { 
    const row = allData[i];
    if (String(row[2] || "").trim().toLowerCase() === userEmail) {
      try { 
        const startDate = new Date(row[5]);
        const endDate = new Date(row[6]);
        // Parse numeric ID part if possible, else use today
        const requestedDateNum = row[0].includes('_') ? Number(row[0].split('_')[1]) : new Date().getTime();

        const currentApproverEmail = row[11]; // Col L
        const approverName = userData.emailToName[currentApproverEmail] || currentApproverEmail || "Pending Assignment";

        myRequests.push({
          requestID: row[0],
          status: row[1],
          leaveType: row[4],
          startDate: convertDateToString(startDate),
          endDate: convertDateToString(endDate),
          totalDays: row[7],
          reason: row[8],
          requestedDate: convertDateToString(new Date(requestedDateNum)),
          supervisorName: approverName, // Shows who is holding the request
          actionDate: convertDateToString(new Date(row[9])),
          actionBy: userData.emailToName[row[10]] || row[10],
          actionByReason: row[12] || "",
          sickNoteUrl: row[13] || ""
        });
      } catch (e) {
        Logger.log("Error parsing row " + i);
      }
    }
  }
  return myRequests;
}

function getAdminLeaveRequests(adminEmail, filter) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  const adminRole = userData.emailToRole[adminEmail] || 'agent';

  if (adminRole !== 'admin' && adminRole !== 'superadmin') return { error: "Permission Denied." };

  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.leaveRequests);
  const allData = reqSheet.getDataRange().getValues();
  const results = [];
  const filterStatus = filter.status.toLowerCase();
  const filterUser = filter.userEmail;

  // Get subordinates for visibility check
  const mySubordinateEmails = new Set(webGetAllSubordinateEmails(adminEmail));

  for (let i = 1; i < allData.length; i++) { 
    const row = allData[i];
    if (!row[0]) continue;

    const requestStatus = (row[1] || "").toString().trim().toLowerCase();
    const requesterEmail = (row[2] || "").toString().trim().toLowerCase();
    const assignedApprover = (row[11] || "").toString().trim().toLowerCase(); 
    
    // 1. Filter by Status
    if (filterStatus !== 'all' && !requestStatus.includes(filterStatus)) continue;

    // 2. Filter by User
    if (filterUser && filterUser !== 'ALL_USERS' && filterUser !== 'ALL_SUBORDINATES' && requesterEmail !== filterUser) continue;

    // 3. Visibility Logic
    let isVisible = false;
    if (adminRole === 'superadmin') {
      isVisible = true;
    } else {
      // Show if assigned to me OR if I am the direct manager/project manager (historical visibility)
      // Note: We check the SNAPSHOT columns (O=14, P=15) if available, else standard check
      const directMgrSnapshot = (row[14] || "").toString().toLowerCase();
      const projectMgrSnapshot = (row[15] || "").toString().toLowerCase();

      if (assignedApprover === adminEmail) isVisible = true;
      else if (directMgrSnapshot === adminEmail) isVisible = true;
      else if (projectMgrSnapshot === adminEmail) isVisible = true;
      else if (mySubordinateEmails.has(requesterEmail)) isVisible = true;
    }

    if (!isVisible) continue;

    try {
        const startDate = new Date(row[5]);
        const endDate = new Date(row[6]);
        const datePart = row[0].split('_')[1];
        const reqDate = datePart ? new Date(Number(datePart)) : new Date();

        results.push({
          requestID: row[0],
          status: row[1],
          requestedByName: row[3],
          leaveType: row[4],
          startDate: convertDateToString(startDate),
          endDate: convertDateToString(endDate),
          totalDays: row[7],
          reason: row[8],
          requestedDate: convertDateToString(reqDate),
          supervisorName: userData.emailToName[assignedApprover] || assignedApprover,
          actionBy: userData.emailToName[row[10]] || row[10],
          actionByReason: row[12],
          requesterBalance: userData.emailToBalances[requesterEmail],
          sickNoteUrl: row[13]
        });
    } catch (e) { }
  }
  return results;
}

function submitLeaveRequest(submitterEmail, request, targetUserEmail) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  
  const requestEmail = (targetUserEmail || submitterEmail).toLowerCase();
  const requestName = userData.emailToName[requestEmail];
  
  if (!requestName) throw new Error(`User account ${requestEmail} not found.`);
  
  // 1. Identify Approvers & Validate
  const directManager = userData.emailToSupervisor[requestEmail];
  const projectManager = userData.emailToProjectManager[requestEmail];

  // CRITICAL FIX: Stop "NA" by blocking submission if Direct Manager is missing
  if (!directManager || directManager === "" || directManager === "na") {
    throw new Error(`Cannot submit request. User ${requestName} does not have a valid Direct Manager assigned in Employees_Core.`);
  }

  // 2. Determine Workflow
  let status = "Pending";
  let assignedApprover = directManager;

  // If Project Manager exists and is different, they approve first
  if (projectManager && projectManager !== "" && projectManager !== directManager) {
    status = "Pending Project Mgr";
    assignedApprover = projectManager;
  } else {
    status = "Pending Direct Mgr"; 
    assignedApprover = directManager;
  }

  // 3. Balance Check
  const startDate = new Date(request.startDate + 'T00:00:00');
  const endDate = request.endDate ? new Date(request.endDate + 'T00:00:00') : startDate;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
  
  const balanceKey = request.leaveType.toLowerCase(); 
  const userBalances = userData.emailToBalances[requestEmail];
  
  // Safety check for balance existence
  if (!userBalances || userBalances[balanceKey] === undefined) {
     throw new Error(`Balance type '${request.leaveType}' not found for user.`);
  }
  if (userBalances[balanceKey] < totalDays) {
    throw new Error(`Insufficient ${request.leaveType} balance. Available: ${userBalances[balanceKey]}, Requested: ${totalDays}.`);
  }

  // 4. File Upload Logic
  let sickNoteUrl = "";
  if (request.fileInfo) {
    try {
      const folder = DriveApp.getFolderById(SICK_NOTE_FOLDER_ID);
      const fileData = Utilities.base64Decode(request.fileInfo.data);
      const blob = Utilities.newBlob(fileData, request.fileInfo.type, request.fileInfo.name);
      const newFile = folder.createFile(blob).setName(`${requestName}_${new Date().toISOString()}_${request.fileInfo.name}`);
      sickNoteUrl = newFile.getUrl();
    } catch (e) { throw new Error("File upload failed: " + e.message); }
  }
  if (balanceKey === 'sick' && !sickNoteUrl) throw new Error("A PDF sick note is mandatory for sick leave.");

  // 5. Save to Sheet (With New Columns)
  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.leaveRequests);
  const requestID = `req_${new Date().getTime()}`;
  
  reqSheet.appendRow([
    requestID,
    status,
    requestEmail,
    requestName,
    request.leaveType,
    startDate, 
    endDate,   
    totalDays,
    request.reason,
    "", // ActionDate
    "", // ActionBy
    assignedApprover, // Col L (12): The person who must approve NOW
    "", // ActionReason
    sickNoteUrl,
    directManager, // Col O (15): Snapshot of Direct Mgr
    projectManager || "" // Col P (16): Snapshot of Project Mgr
  ]);
  
  SpreadsheetApp.flush(); 
  
  // Format the approver name for the success message
  const approverName = userData.emailToName[assignedApprover] || assignedApprover;
  return `Request submitted successfully. It is now ${status} (${approverName}).`;
}

function approveDenyRequest(adminEmail, requestID, newStatus, reason) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database); 
  const userData = getUserDataFromDb(dbSheet); 
  
  // Security Check
  const adminRole = userData.emailToRole[adminEmail] || 'agent';
  if (adminRole === 'agent') throw new Error("Permission denied.");

  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.leaveRequests); 
  const allData = reqSheet.getDataRange().getValues();
  
  let rowIndex = -1;
  let requestRow = [];

  // Find Request
  for (let i = 1; i < allData.length; i++) { 
    if (allData[i][0] === requestID) { 
      rowIndex = i + 1;
      requestRow = allData[i];
      break; 
    }
  }
  if (rowIndex === -1) throw new Error("Request ID not found.");

  const currentStatus = requestRow[1]; // Column B
  const assignedApprover = (requestRow[11] || "").toLowerCase(); // Column L
  const requesterEmail = requestRow[2];

  // 1. Validate Approver
  // Superadmins can override, otherwise must be the assigned approver
  if (adminRole !== 'superadmin' && assignedApprover !== adminEmail) {
    throw new Error("This request is not currently assigned to you for approval.");
  }

  // 2. Handle Denial (Immediate Stop)
  if (newStatus === 'Denied') {
    reqSheet.getRange(rowIndex, 2).setValue("Denied");
    reqSheet.getRange(rowIndex, 10).setValue(new Date());
    reqSheet.getRange(rowIndex, 11).setValue(adminEmail);
    reqSheet.getRange(rowIndex, 13).setValue(reason || "Denied by " + adminEmail);
    return "Request denied.";
  }

  // 3. Handle Approval Logic (State Machine)
  
  // CASE A: Project Manager Approving -> Move to Direct Manager
  if (currentStatus === "Pending Project Mgr") {
    const directManager = userData.emailToSupervisor[requesterEmail];
    if (!directManager) throw new Error("Direct Manager not found for next step.");

    reqSheet.getRange(rowIndex, 2).setValue("Pending Direct Mgr"); // Update Status
    reqSheet.getRange(rowIndex, 12).setValue(directManager);       // Update Assigned Approver
    reqSheet.getRange(rowIndex, 13).setValue(`Project Mgr (${adminEmail}) Approved. Forwarded to Direct Mgr.`); // Log history in reason
    
    return "Project Manager Approval Recorded. Request forwarded to Direct Manager.";
  }

  // CASE B: Direct Manager Approving -> Finalize
  if (currentStatus === "Pending Direct Mgr" || currentStatus === "Pending") {
    // Deduct Balance Logic
    const leaveType = requestRow[4];
    const totalDays = requestRow[7];
    const balanceKey = leaveType.toLowerCase();
    
    // Map balance columns (Standard: Annual=H(7), Sick=I(8), Casual=J(9)) 
    // *Note: Index in array is 0-based, Column in sheet is 1-based.
    // getUserDataFromDb mapped these. Let's find the Col index dynamically or assume standard.
    // Standard Core Sheet: Annual(H=8), Sick(I=9), Casual(J=10) based on new structure?
    // Let's use getUserDataFromDb row index mapping.
    
    const userDBRow = userData.emailToRow[requesterEmail];
    const colMap = { "annual": 8, "sick": 9, "casual": 10 }; // Matches Employees_Core structure
    const balanceCol = colMap[balanceKey];

    if (balanceCol) {
      const balanceRange = dbSheet.getRange(userDBRow, balanceCol);
      const currentBal = balanceRange.getValue();
      balanceRange.setValue(currentBal - totalDays);
    }

    // Submit Schedule (Auto-log)
    // Call existing submitScheduleRange logic
    const reqName = requestRow[3];
    const reqStartDateStr = Utilities.formatDate(new Date(requestRow[5]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const reqEndDateStr = Utilities.formatDate(new Date(requestRow[6]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    submitScheduleRange(adminEmail, requesterEmail, reqName, reqStartDateStr, reqEndDateStr, "", "", leaveType);

    // Finalize Request Sheet
    reqSheet.getRange(rowIndex, 2).setValue("Approved");
    reqSheet.getRange(rowIndex, 10).setValue(new Date());
    reqSheet.getRange(rowIndex, 11).setValue(adminEmail);
    reqSheet.getRange(rowIndex, 13).setValue(reason || "");

    return "Final Approval Granted. Schedule updated and balance deducted.";
  }

  return "Error: Invalid Request Status.";
}

// ================= NEW/MODIFIED FUNCTIONS =================

// ================= FIXED HISTORY READER =================
function getAdherenceRange(adminEmail, userNames, startDateStr, endDateStr) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  const adminRole = userData.emailToRole[adminEmail] || 'agent';
  const timeZone = Session.getScriptTimeZone();
  
  let targetUserNames = [];
  if (adminRole === 'agent') {
    const selfName = userData.emailToName[adminEmail];
    if (!selfName) throw new Error("Your user account was not found.");
    targetUserNames = [selfName];
  } else {
    targetUserNames = userNames;
  }

  const targetUserSet = new Set(targetUserNames.map(name => name.toLowerCase()));
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);
  
  const results = [];
  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scheduleMap = {}; 

  for (let i = 1; i < scheduleData.length; i++) {
    const schName = (scheduleData[i][0] || "").toLowerCase();
    if (targetUserSet.has(schName)) {
      try {
        const schDate = parseDate(scheduleData[i][1]);
        if (schDate >= startDate && schDate <= endDate) {
          const schDateStr = Utilities.formatDate(schDate, timeZone, "MM/dd/yyyy");
          const leaveType = scheduleData[i][5] || "Present";
          scheduleMap[`${schName}:${schDateStr}`] = leaveType;
        }
      } catch (e) {}
    }
  }

  const adherenceSheet = getOrCreateSheet(ss, SHEET_NAMES.adherence);
  const adherenceData = adherenceSheet.getDataRange().getValues();
  const resultsLookup = new Set();

  for (let i = 1; i < adherenceData.length; i++) {
    const row = adherenceData[i];
    const rowUser = (row[1] || "").toString().trim().toLowerCase();

    if (targetUserSet.has(rowUser)) {
      try {
        const rowDate = new Date(row[0]);
        if (rowDate >= startDate && rowDate <= endDate) {
          results.push({
            date: convertDateToString(row[0]),
            userName: row[1],
            login: convertDateToString(row[2]),
            firstBreakIn: convertDateToString(row[3]),
            firstBreakOut: convertDateToString(row[4]),
            lunchIn: convertDateToString(row[5]),
            lunchOut: convertDateToString(row[6]),
            lastBreakIn: convertDateToString(row[7]),
            lastBreakOut: convertDateToString(row[8]),
            logout: convertDateToString(row[9]),
            // Fix: Explicitly parse numbers
            tardy: Number(row[10]) || 0,
            overtime: Number(row[11]) || 0,
            earlyLeave: Number(row[12]) || 0,
            leaveType: row[13] || "Present", // Fallback if missing
            firstBreakExceed: row[16] || 0,
            lunchExceed: row[17] || 0,
            lastBreakExceed: row[18] || 0,
            breakWindowViolation: row[21] || "No",
            netLoginHours: row[22] || 0,
            preShiftOvertime: Number(row[23]) || 0 // Col X (Index 23)
          });
          const rDateStr = Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy");
          resultsLookup.add(`${rowUser}:${rDateStr}`);
        }
      } catch (e) {
        Logger.log(`Skipping adherence row ${i+1}. Error: ${e.message}`);
      }
    }
  }

  // Fill in missing days
  let currentDate = new Date(startDate);
  const oneDayInMs = 24 * 60 * 60 * 1000;
  
  while (currentDate <= endDate) {
    const currentDateStr = Utilities.formatDate(currentDate, timeZone, "MM/dd/yyyy");
    for (const userName of targetUserNames) {
      const userNameLower = userName.toLowerCase();
      const adherenceKey = `${userNameLower}:${currentDateStr}`;
      
      if (!resultsLookup.has(adherenceKey)) {
        const scheduleKey = `${userNameLower}:${currentDateStr}`;
        const leaveType = scheduleMap[scheduleKey]; 
        let finalLeaveType = "Day Off";
        
        if (leaveType) {
          finalLeaveType = (leaveType.toLowerCase() === "present") ? "Absent" : leaveType;
        }

        results.push({
          date: convertDateToString(currentDate),
          userName: userName,
          login: null, firstBreakIn: null, firstBreakOut: null, lunchIn: null,
          lunchOut: null, lastBreakIn: null, lastBreakOut: null, logout: null,
          tardy: 0, overtime: 0, earlyLeave: 0,
          leaveType: finalLeaveType,
          firstBreakExceed: 0, lunchExceed: 0, lastBreakExceed: 0,
          preShiftOvertime: 0
        });
      }
    }
    currentDate.setTime(currentDate.getTime() + oneDayInMs);
  }

  results.sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.userName.localeCompare(b.userName);
  });

  return results;
}


// REPLACE this function
function getMySchedule(userEmail) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  const userRole = userData.emailToRole[userEmail] || 'agent';

  const targetEmails = new Set();
  if (userRole === 'agent') {
    targetEmails.add(userEmail);
  } else {
    const subEmails = webGetAllSubordinateEmails(userEmail);
    subEmails.forEach(email => targetEmails.add(email.toLowerCase()));
  }

  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const timeZone = Session.getScriptTimeZone();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const nextSevenDays = new Date(today);
  nextSevenDays.setDate(today.getDate() + 7);

  const mySchedule = [];
  for (let i = 1; i < scheduleData.length; i++) {
    const row = scheduleData[i];
    // *** MODIFIED: Read Email from Col G (index 6) ***
    const schEmail = (row[6] || "").toString().trim().toLowerCase(); 
    
    if (targetEmails.has(schEmail)) {
      try {
        // *** MODIFIED: Read Date from Col B (index 1) ***
        const schDate = parseDate(row[1]);
        if (schDate >= today && schDate < nextSevenDays) { 
          
          // *** MODIFIED: Read times/leave from Col C, E, F ***
          let startTime = row[2]; // Col C
          let endTime = row[4];   // Col E
          let leaveType = row[5] || ""; // Col F

          // *** MODIFIED for Request 3: Handle "Day Off" ***
          if (leaveType === "" && !startTime) {
            leaveType = "Day Off";
          } else if (leaveType === "" && startTime) {
            leaveType = "Present"; // Default if times exist but no type
          }
          // *** END MODIFICATION ***
          
          if (startTime instanceof Date) {
            startTime = Utilities.formatDate(startTime, timeZone, "HH:mm");
          }
          if (endTime instanceof Date) {
            endTime = Utilities.formatDate(endTime, timeZone, "HH:mm");
          }
          
          mySchedule.push({
            userName: userData.emailToName[schEmail] || schEmail,
            date: convertDateToString(schDate),
            leaveType: leaveType,
            startTime: startTime,
            endTime: endTime
          });
        }
      } catch(e) {
        Logger.log(`Skipping schedule row ${i+1}. Invalid date. Error: ${e.message}`);
      }
    }
  }
  
  mySchedule.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    if (dateA < dateB) return -1;
    if (dateA > dateB) return 1;
    return a.userName.localeCompare(b.userName);
  });
  return mySchedule;
}


// (No Change)
function adjustLeaveBalance(adminEmail, userEmail, leaveType, amount, reason) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  
  const adminRole = userData.emailToRole[adminEmail] || 'agent';
  if (adminRole !== 'admin' && adminRole !== 'superadmin') {
    throw new Error("Permission denied. Only admins can adjust balances.");
  }
  
  const balanceKey = leaveType.toLowerCase();
  const balanceCol = { annual: 4, sick: 5, casual: 6 }[balanceKey];
  if (!balanceCol) {
    throw new Error(`Unknown leave type: ${leaveType}.`);
  }
  
  const userRow = userData.emailToRow[userEmail];
  const userName = userData.emailToName[userEmail];
  if (!userRow) {
    throw new Error(`Could not find user ${userName} in Data Base.`);
  }
  
  const balanceRange = dbSheet.getRange(userRow, balanceCol);
  const currentBalance = parseFloat(balanceRange.getValue()) || 0;
  const newBalance = currentBalance + amount;
  
  balanceRange.setValue(newBalance);
  
  // Log the adjustment
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  logsSheet.appendRow([
    new Date(), 
    userName, 
    adminEmail, 
    "Balance Adjustment", 
    `Admin: ${adminEmail} | User: ${userName} | Type: ${leaveType} | Amount: ${amount} | Reason: ${reason} | Old: ${currentBalance} | New: ${newBalance}`
  ]);
  
  return `Successfully adjusted ${userName}'s ${leaveType} balance from ${currentBalance} to ${newBalance}.`;
}

// ================= PHASE 9: BULK SCHEDULE IMPORTER =================
function importScheduleCSV(adminEmail, csvData) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  const adminRole = userData.emailToRole[adminEmail] || 'agent';
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'manager') {
    throw new Error("Permission denied. Only admins/managers can import schedules.");
  }
  
  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  const timeZone = Session.getScriptTimeZone();
  
  // Build map of existing schedules
  const userScheduleMap = {};
  for (let i = 1; i < scheduleData.length; i++) {
    const rowEmail = scheduleData[i][6];
    const rowDateRaw = scheduleData[i][1]; 
    if (rowEmail && rowDateRaw) {
      const email = rowEmail.toLowerCase();
      if (!userScheduleMap[email]) userScheduleMap[email] = {};
      const rowDate = new Date(rowDateRaw);
      const rowDateStr = Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy");
      userScheduleMap[email][rowDateStr] = i + 1;
    }
  }
  
  let daysUpdated = 0;
  let daysCreated = 0;
  let errors = 0;
  let errorLog = [];

  for (const row of csvData) {
    try {
      const userName = row.Name;
      const userEmail = (row['agent email'] || "").toLowerCase();
      
      const targetStartDate = parseDate(row.StartDate);
      let startTime = parseCsvTime(row.ShiftStartTime, timeZone);
      const targetEndDate = parseDate(row.EndDate);
      let endTime = parseCsvTime(row.ShiftEndTime, timeZone);
      
      // --- PHASE 9: Parse New Break Windows ---
      let b1s = parseCsvTime(row.Break1Start, timeZone);
      let b1e = parseCsvTime(row.Break1End, timeZone);
      let ls = parseCsvTime(row.LunchStart, timeZone);
      let le = parseCsvTime(row.LunchEnd, timeZone);
      let b2s = parseCsvTime(row.Break2Start, timeZone);
      let b2e = parseCsvTime(row.Break2End, timeZone);
      
      let leaveType = row.LeaveType || "Present";
      
      if (!userName || !userEmail) throw new Error("Missing Name or agent email.");
      if (!targetStartDate || isNaN(targetStartDate.getTime())) throw new Error(`Invalid StartDate: ${row.StartDate}.`);
      
      const startDateStr = Utilities.formatDate(targetStartDate, timeZone, "MM/dd/yyyy");

      if (leaveType.toLowerCase() !== "present") {
        startTime = ""; endTime = "";
        b1s = ""; b1e = ""; ls = ""; le = ""; b2s = ""; b2e = "";
      }

      let finalEndDate;
      if (leaveType.toLowerCase() === "present" && targetEndDate && !isNaN(targetEndDate.getTime())) {
        finalEndDate = targetEndDate;
      } else {
        finalEndDate = new Date(targetStartDate);
      }

      const emailMap = userScheduleMap[userEmail] || {};
      
      const result = updateOrAddSingleSchedule(
      scheduleSheet, userScheduleMap, logsSheet,
      userEmail, userName, 
      currentDate, 
      shiftEndDate, 
      currentDateStr, 
      startTime, endTime, leaveType, puncherEmail,
      "", "", "", "", "", "" // <--- Pass empty break windows for manual entry
    );
      
      if (result === "UPDATED") daysUpdated++;
      if (result === "CREATED") daysCreated++;
    } catch (e) {
      errors++;
      errorLog.push(`Row ${row.Name}/${row.StartDate}: ${e.message}`);
    }
  }

  if (errors > 0) {
    return `Error: Import complete with ${errors} errors. (Created: ${daysCreated}, Updated: ${daysUpdated}). Errors: ${errorLog.join(' | ')}`;
  }
  return `Import successful. Records Created: ${daysCreated}, Records Updated: ${daysUpdated}.`;
}

// ================= PHASE 7: DASHBOARD ANALYTICS =================
function getDashboardData(adminEmail, userEmails, date) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  const adminRole = userData.emailToRole[adminEmail] || 'agent';
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'manager') {
    throw new Error("Permission denied.");
  }
  
  const timeZone = Session.getScriptTimeZone();
  const targetDate = new Date(date);
  const targetDateStr = Utilities.formatDate(targetDate, timeZone, "MM/dd/yyyy");
  const targetUserSet = new Set(userEmails.map(e => e.toLowerCase()));
  
  const userStatusMap = {};
  const userMetricsMap = {}; 
  
  // WFM Aggregate Counters
  let countScheduled = 0;
  let countWorking = 0; // Logged In
  let countUnavailable = 0; // Absent, Leave, or Scheduled but not logged in yet
  
  userEmails.forEach(email => {
    const lEmail = email.toLowerCase();
    const name = userData.emailToName[lEmail] || lEmail;
    userStatusMap[lEmail] = "Day Off"; 
    userMetricsMap[name] = {
      name: name, tardy: 0, earlyLeave: 0, overtime: 0,
      breakExceed: 0, lunchExceed: 0, scheduled: false
    };
  });

  const scheduledEmails = new Set();

  // 1. Get Schedule Data & Calculate Capacity Base
  const scheduleSheet = getOrCreateSheet(ss, SHEET_NAMES.schedule);
  const scheduleData = scheduleSheet.getDataRange().getValues();
  for (let i = 1; i < scheduleData.length; i++) {
    const row = scheduleData[i];
    const schEmail = (row[6] || "").toLowerCase();
    if (!targetUserSet.has(schEmail)) continue;
    
    const schDate = new Date(row[1]);
    const schDateStr = Utilities.formatDate(schDate, timeZone, "MM/dd/yyyy");
    
    if (schDateStr === targetDateStr) {
      const leaveType = (row[5] || "").toString().trim().toLowerCase();
      const startTime = row[2];
      
      if (leaveType === "" && !startTime) {
        userStatusMap[schEmail] = "Day Off";
      } else if (leaveType === "present" || (leaveType === "" && startTime)) {
        scheduledEmails.add(schEmail);
        userStatusMap[schEmail] = "Pending Login";
        
        // Mark metric object as scheduled
        const name = userData.emailToName[schEmail];
        if (userMetricsMap[name]) userMetricsMap[name].scheduled = true;
        
        countScheduled++;
        countUnavailable++; // Assume unavailable until we find a punch
      } else if (leaveType === "absent") {
        userStatusMap[schEmail] = "Absent";
        countScheduled++; // Absent counts as scheduled but lost
        countUnavailable++;
      } else {
        userStatusMap[schEmail] = "On Leave";
        // Leave usually implies scheduled hours that are now non-productive
        countScheduled++;
        countUnavailable++;
      }
    }
  }
  
  // 2. Get Adherence & Status
  const adherenceSheet = getOrCreateSheet(ss, SHEET_NAMES.adherence);
  const adherenceData = adherenceSheet.getDataRange().getValues();
  
  // Pre-fetch other codes for status refinement
  const otherCodesSheet = getOrCreateSheet(ss, SHEET_NAMES.otherCodes);
  const otherCodesData = otherCodesSheet.getDataRange().getValues();
  const userLastOtherCode = {};
  
  for (let i = otherCodesData.length - 1; i > 0; i--) { 
    const row = otherCodesData[i];
    const rowDate = new Date(row[0]);
    const rowShiftDate = getShiftDate(rowDate, SHIFT_CUTOFF_HOUR);
    if (Utilities.formatDate(rowShiftDate, timeZone, "MM/dd/yyyy") === targetDateStr) {
      const uName = row[1];
      const uEmail = userData.nameToEmail[uName];
      if (uEmail && targetUserSet.has(uEmail.toLowerCase())) {
        if (!userLastOtherCode[uEmail.toLowerCase()]) { 
          const [code, type] = (row[2] || "").split(" ");
          userLastOtherCode[uEmail.toLowerCase()] = { code: code, type: type };
        }
      }
    }
  }
  
  let totalDeviationSeconds = 0;

  for (let i = 1; i < adherenceData.length; i++) {
    const row = adherenceData[i];
    const rowDate = new Date(row[0]);
    if (Utilities.formatDate(rowDate, timeZone, "MM/dd/yyyy") === targetDateStr) { 
      const userName = row[1];
      const userEmail = userData.nameToEmail[userName];
      
      if (userEmail && targetUserSet.has(userEmail.toLowerCase())) {
        const lEmail = userEmail.toLowerCase();
        
        // Status Logic
        if (scheduledEmails.has(lEmail)) {
          const login = row[2], b1_in = row[3], b1_out = row[4], l_in = row[5],
                l_out = row[6], b2_in = row[7], b2_out = row[8], logout = row[9];
          
          let agentStatus = "Pending Login";
          
          if (login && !logout) {
            agentStatus = "Logged In";
            
            // Check sub-status
            const lastOther = userLastOtherCode[lEmail];
            let onBreak = false;
            
            if (lastOther && lastOther.type === 'In') {
              agentStatus = `On ${lastOther.code}`;
              onBreak = true;
            } else {
              if (b1_in && !b1_out) { agentStatus = "On First Break"; onBreak = true; }
              if (l_in && !l_out) { agentStatus = "On Lunch"; onBreak = true; }
              if (b2_in && !b2_out) { agentStatus = "On Last Break"; onBreak = true; }
            }
            
            if (!onBreak) {
               // They are truly working
               countWorking++;
               countUnavailable--; // They were counted as unavailable initially
            }
          } else if (login && logout) {
            agentStatus = "Logged Out";
          }
          userStatusMap[lEmail] = agentStatus;
          scheduledEmails.delete(lEmail); // Remove from set so we don't process again
        }
        
        // Metrics Summation
        // Metrics Summation (Ensuring Pre-Shift OT is added)
        const tardy = parseFloat(row[10]) || 0;
        const overtime = parseFloat(row[11]) || 0; // Post-Shift
        const earlyLeave = parseFloat(row[12]) || 0;
        const breakExceed = (parseFloat(row[16]) || 0) + (parseFloat(row[18]) || 0);
        const lunchExceed = parseFloat(row[17]) || 0;
        const preShiftOT = parseFloat(row[23]) || 0; // Col X (Index 23)

        // Sum deviation for Schedule Adherence
        totalDeviationSeconds += (tardy + earlyLeave + breakExceed + lunchExceed);

        if (userMetricsMap[userName]) {
          userMetricsMap[userName].tardy += tardy;
          userMetricsMap[userName].earlyLeave += earlyLeave;
          userMetricsMap[userName].overtime += (overtime + preShiftOT); // Combined OT
          userMetricsMap[userName].breakExceed += breakExceed;
          userMetricsMap[userName].lunchExceed += lunchExceed;
        }
      }
    }
  }
  
  // 3. Get Pending Requests (Same as before)
  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.leaveRequests);
  const reqData = reqSheet.getDataRange().getValues();
  const pendingRequests = [];
  for (let i = 1; i < reqData.length; i++) {
    const row = reqData[i];
    const reqEmail = (row[2] || "").toLowerCase();
    if (row[1] && row[1].toString().toLowerCase().includes('pending') && targetUserSet.has(reqEmail)) {
      pendingRequests.push({ name: row[3], type: row[4], startDate: convertDateToString(new Date(row[5])), days: row[7] });
    }
  }
  
  // 4. Calculate Final WFM Metrics
  // Assumption: Avg shift is 9 hours (32400 sec) for calculation
  const ESTIMATED_SHIFT_SECONDS = 32400; 
  const totalScheduledSeconds = countScheduled * ESTIMATED_SHIFT_SECONDS;
  
  let adherencePct = 100;
  if (totalScheduledSeconds > 0) {
    adherencePct = Math.max(0, 100 - ((totalDeviationSeconds / totalScheduledSeconds) * 100));
  }
  
  let capacityPct = 0;
  if (countScheduled > 0) {
    capacityPct = (countWorking / countScheduled) * 100;
  }
  
  let shrinkagePct = 0;
  if (countScheduled > 0) {
    // Shrinkage = Agents unavailable / Total Scheduled
    shrinkagePct = (countUnavailable / countScheduled) * 100;
  }

  const agentStatusList = [];
  for (const email of targetUserSet) {
      const name = userData.emailToName[email] || email;
      const status = userStatusMap[email] || "Day Off";
      agentStatusList.push({ name: name, status: status });
  }
  agentStatusList.sort((a, b) => a.name.localeCompare(b.name));
  
  const individualAdherenceMetrics = Object.values(userMetricsMap);

  return {
    wfmMetrics: {
      adherence: adherencePct.toFixed(1),
      capacity: capacityPct.toFixed(1),
      shrinkage: shrinkagePct.toFixed(1),
      working: countWorking,
      scheduled: countScheduled,
      unavailable: countUnavailable
    },
    agentStatusList: agentStatusList,
    individualAdherenceMetrics: individualAdherenceMetrics,
    pendingRequests: pendingRequests
  };
}

// --- NEW: "My Team" Helper Functions ---
function saveMyTeam(adminEmail, userEmails) {
  try {
    // Uses Google Apps Script's built-in User Properties for saving user-specific settings.
    const userProperties = PropertiesService.getUserProperties();
    userProperties.setProperty('myTeam', JSON.stringify(userEmails));
    return "Successfully saved 'My Team' preference.";
  } catch (e) {
    throw new Error("Failed to save team preferences: " + e.message);
  }
}

function getMyTeam(adminEmail) {
  try {
    const userProperties = PropertiesService.getUserProperties();
    // Getting properties implicitly forces the Google auth dialog if needed.
    const properties = userProperties.getProperties(); 
    const myTeam = properties['myTeam'];
    return myTeam ? JSON.parse(myTeam) : [];
  } catch (e) {
    Logger.log("Failed to load team preferences: " + e.message);
    // Throwing an error here would break the dashboard's initial load. 
    // We return an empty array instead, and let the front-end handle the fallback.
   return [];
  }
}

// --- NEW: Reporting Line Function ---
function updateReportingLine(adminEmail, userEmail, newSupervisorEmail) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  
  const adminRole = userData.emailToRole[adminEmail] || 'agent';
  if (adminRole !== 'admin' && adminRole !== 'superadmin') {
    throw new Error("Permission denied. Only admins can change reporting lines.");
  }
  
  const userName = userData.emailToName[userEmail];
  const newSupervisorName = userData.emailToName[newSupervisorEmail];
  if (!userName) throw new Error(`Could not find user: ${userEmail}`);
  if (!newSupervisorName) throw new Error(`Could not find new supervisor: ${newSupervisorEmail}`);

  const userRow = userData.emailToRow[userEmail];
  const currentUserSupervisor = userData.emailToSupervisor[userEmail];

  // Check for auto-approval
  let canAutoApprove = false;
  if (adminRole === 'superadmin') {
    canAutoApprove = true;
  } else if (adminRole === 'admin') {
    // Check if both the user's current supervisor AND the new supervisor report to this admin
    const currentSupervisorManager = userData.emailToSupervisor[currentUserSupervisor];
    const newSupervisorManager = userData.emailToSupervisor[newSupervisorEmail];
    
    if (currentSupervisorManager === adminEmail && newSupervisorManager === adminEmail) {
      canAutoApprove = true;
    }
  }

  if (!canAutoApprove) {
    // This is where we will build Phase 2 (requesting the change)
    // For now, we will just show a permission error.
    throw new Error("Permission Denied: You do not have authority to approve this change. (This will become a request in Phase 2).");
  }

  // --- Auto-Approval Logic ---
  // Update the SupervisorEmail column (Column G = 7)
  dbSheet.getRange(userRow, 7).setValue(newSupervisorEmail);
  
  // Log the change
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  logsSheet.appendRow([
    new Date(), 
    userName, 
    adminEmail, 
    "Reporting Line Change", 
    `User: ${userName} moved to Supervisor: ${newSupervisorName} by ${adminEmail}`
  ]);
  
  return `${userName} has been successfully reassigned to ${newSupervisorName}.`;
}

// [START] MODIFICATION 2: Replace _ONE_TIME_FIX_TEMPLATE


/**
 * NEW: User submits full registration details + 2 managers.
 */
function webSubmitFullRegistration(form) {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore); 
    const userData = getUserDataFromDb(ss); // Reuse helper
    const regSheet = getOrCreateSheet(ss, SHEET_NAMES.pendingRegistrations);

    let userName = userEmail;
    const userObj = userData.userList.find(u => u.email === userEmail);
    if (userObj) userName = userObj.name;

    if (!form.directManager || !form.functionalManager) throw new Error("Both managers are required.");
    if (!form.address || !form.phone) throw new Error("Address and Phone are required.");
    
    // Check for existing
    const data = regSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === userEmail && data[i][5] !== 'Rejected' && data[i][5] !== 'Approved') { 
         // Simplistic check, usually status implies active workflow
         throw new Error("You already have a pending registration request.");
      }
    }

    const requestID = `REG-${new Date().getTime()}`;
    
    regSheet.appendRow([
      requestID,
      userEmail,
      userName,
      form.directManager,     
      form.functionalManager, 
      "Pending",              // DirectStatus
      "Pending",              // FunctionalStatus (Wait for DM)
      form.address,
      form.phone,
      new Date(),
      "",                     // HiringDate (Empty start)
      1                       // WorkflowStage: 1 = Direct Manager
    ]);

    return "Registration submitted! Waiting for Direct Manager approval.";
  } catch (err) {
    Logger.log("webSubmitFullRegistration Error: " + err.message);
    return "Error: " + err.message;
  }
}

/**
 * For the pending user to check their own status.
 */
function webGetMyRegistrationStatus() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const regSheet = getOrCreateSheet(getSpreadsheet(), SHEET_NAMES.pendingRegistrations);
    const data = regSheet.getDataRange().getValues();

    for (let i = data.length - 1; i > 0; i--) { // Check newest first
      if (data[i][1] === userEmail) {
        return { status: data[i][4], supervisor: data[i][3] }; // Returns { status: "Pending" } or { status: "Denied" }
      }
    }
    return { status: "New" }; // No submission found
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * NEW: Admins see requests where THEY are the approver.
 */
function webGetPendingRegistrations() {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const userData = getUserDataFromDb(ss);
    const adminRole = userData.emailToRole[adminEmail] || 'agent';
    if (adminRole === 'agent') throw new Error("Permission denied.");

    const regSheet = getOrCreateSheet(ss, SHEET_NAMES.pendingRegistrations);
    const data = regSheet.getDataRange().getValues();
    const pending = [];
    const headers = data[0]; // Get headers to map indexes safely
    
    // Map Indexes
    const idx = {
      id: headers.indexOf("RequestID"),
      email: headers.indexOf("UserEmail"),
      name: headers.indexOf("UserName"),
      dm: headers.indexOf("DirectManagerEmail"),
      fm: headers.indexOf("FunctionalManagerEmail"),
      dmStat: headers.indexOf("DirectStatus"),
      fmStat: headers.indexOf("FunctionalStatus"),
      ts: headers.indexOf("RequestTimestamp"),
      hDate: headers.indexOf("HiringDate"),
      stage: headers.indexOf("WorkflowStage")
    };

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const directMgr = (row[idx.dm] || "").toLowerCase();
      const funcMgr = (row[idx.fm] || "").toLowerCase();
      const stage = Number(row[idx.stage] || 0); // Default to 0 if missing
      const hiringDate = row[idx.hDate] ? convertDateToString(new Date(row[idx.hDate])).split('T')[0] : ""; // YYYY-MM-DD

      let actionRequired = false;
      let myRoleInRequest = "";

      if (adminRole === 'superadmin') {
        // Superadmin sees everything active
        if (stage === 1 || stage === 2) {
           actionRequired = true;
           myRoleInRequest = (stage === 1) ? "Direct" : "Functional";
        }
      } else {
        // Sequential Logic
        // Stage 1: Direct Manager must act
        if (stage === 1 && directMgr === adminEmail) {
          actionRequired = true;
          myRoleInRequest = "Direct";
        }
        // Stage 2: Functional/Project Manager must act (only after DM approved)
        else if (stage === 2 && funcMgr === adminEmail) {
          actionRequired = true;
          myRoleInRequest = "Functional";
        }
      }

      if (actionRequired) {
        pending.push({
          requestID: row[idx.id],
          userEmail: row[idx.email],
          userName: row[idx.name],
          approverRole: myRoleInRequest, 
          otherStatus: myRoleInRequest === "Direct" ? "Step 1 of 2" : "Step 2: Final Approval",
          timestamp: convertDateToString(new Date(row[idx.ts])),
          hiringDate: hiringDate, // Pass existing date if any
          stage: stage
        });
      }
    }

    return pending.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * NEW: Approves one side of the request. If both approved -> HIRE.
 */
function webApproveDenyRegistration(requestID, userEmail, supervisorEmail, newStatus, hiringDateStr) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const regSheet = getOrCreateSheet(ss, SHEET_NAMES.pendingRegistrations);
    const data = regSheet.getDataRange().getValues();
    const headers = data[0];
    
    // Find Indexes
    const idx = {
      id: headers.indexOf("RequestID"),
      dmStat: headers.indexOf("DirectStatus"),
      fmStat: headers.indexOf("FunctionalStatus"),
      hDate: headers.indexOf("HiringDate"),
      stage: headers.indexOf("WorkflowStage")
    };

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idx.id] === requestID) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) throw new Error("Request not found.");

    const row = regSheet.getRange(rowIndex, 1, 1, regSheet.getLastColumn()).getValues()[0];
    const currentStage = Number(row[idx.stage] || 1);

    // --- DENY LOGIC (Applies to both steps) ---
    if (newStatus === 'Denied') {
      regSheet.getRange(rowIndex, idx.dmStat + 1).setValue("Denied");
      regSheet.getRange(rowIndex, idx.fmStat + 1).setValue("Denied");
      // Reset stage or set to -1 to indicate closed
      regSheet.getRange(rowIndex, idx.stage + 1).setValue(-1); 
      return { success: true, message: "Registration denied and closed." };
    }

    // --- APPROVAL LOGIC ---
    
    // STEP 1: Direct Manager Approval
    if (currentStage === 1) {
      if (!hiringDateStr) throw new Error("Direct Manager must provide a Hiring Date.");
      
      // Validate Date
      if (isNaN(new Date(hiringDateStr).getTime())) throw new Error("Invalid Hiring Date.");

      regSheet.getRange(rowIndex, idx.dmStat + 1).setValue("Approved");
      regSheet.getRange(rowIndex, idx.hDate + 1).setValue(new Date(hiringDateStr)); // Save Date
      regSheet.getRange(rowIndex, idx.stage + 1).setValue(2); // Move to Stage 2
      
      return { success: true, message: "Step 1 Approved. Request forwarded to Project Manager." };
    }

    // STEP 2: Project Manager Approval
    if (currentStage === 2) {
      // Finalize
      regSheet.getRange(rowIndex, idx.fmStat + 1).setValue("Approved");
      regSheet.getRange(rowIndex, idx.stage + 1).setValue(3); // Completed
      
      // Reuse existing activation logic, ensuring we pass the hiring date from the sheet if not passed explicitly
      const finalHiringDate = hiringDateStr || row[idx.hDate];
      return activateUser(ss, row, finalHiringDate);
    }

    return { success: false, message: "Invalid Workflow State." };

  } catch (e) {
    Logger.log("webApproveDenyRegistration Error: " + e.message);
    return { error: e.message };
  }
}

// Helper to finalize activation
function activateUser(ss, regRow, hiringDateStr) {
  const userEmail = regRow[1];
  const userName = regRow[2];
  const directMgr = regRow[3];
  const funcMgr = regRow[4];
  const address = regRow[7];
  const phone = regRow[8];
  
  // Update Core & PII
  const coreSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  
  // 1. Find user in Core (created during auto-registration in getUserInfo)
  // Or if they don't exist, append. But usually they exist as "Pending".
  const coreData = coreSheet.getDataRange().getValues();
  let coreRow = -1;
  for(let i=1; i<coreData.length; i++) {
      if (coreData[i][2] === userEmail) { // Col C is Email
          coreRow = i + 1;
          break;
      }
  }
  
  if (coreRow === -1) throw new Error("User record missing in Core DB.");
  
  // Update Core: Status, Managers
  coreSheet.getRange(coreRow, 5).setValue("Active"); // Status
  coreSheet.getRange(coreRow, 6).setValue(directMgr);
  coreSheet.getRange(coreRow, 7).setValue(funcMgr);
  
  // Update PII: Address, Phone, Hiring Date
  // Need to find PII row by EmployeeID. 
  const empID = coreSheet.getRange(coreRow, 1).getValue();
  
  const piiData = piiSheet.getDataRange().getValues();
  let piiRow = -1;
  for(let i=1; i<piiData.length; i++) {
      if (piiData[i][0] === empID) {
          piiRow = i + 1;
          break;
      }
  }
  
  // If PII row doesn't exist (migration gap), create it
  if (piiRow === -1) {
      piiSheet.appendRow([empID, new Date(hiringDateStr), "", "", address, phone, "", ""]);
  } else {
      piiSheet.getRange(piiRow, 2).setValue(new Date(hiringDateStr));
      piiSheet.getRange(piiRow, 5).setValue(address);
      piiSheet.getRange(piiRow, 6).setValue(phone);
  }
  
  // Create Folders
   try {
      const rootFolders = DriveApp.getFoldersByName("KOMPASS_HR_Files");
      if (rootFolders.hasNext()) {
        const root = rootFolders.next();
        const empFolders = root.getFoldersByName("Employee_Files");
        if (empFolders.hasNext()) {
          const parent = empFolders.next();
          const personalFolder = parent.createFolder(`${userName}_${empID}`);
          personalFolder.createFolder("Payslips");
          personalFolder.createFolder("Onboarding_Docs");
          personalFolder.createFolder("Sick_Notes");
        }
      }
    } catch (e) {
      Logger.log("Folder creation error: " + e.message);
    }

  return { success: true, message: "User fully approved and activated!" };
}
// --- ADD TO THE END OF code.gs ---

// ==========================================================
// === ANNOUNCEMENTS MODULE ===
// ==========================================================

/**
 * Fetches only active announcements for all users.
 */
function webGetAnnouncements() {
  try {
    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.announcements);
    const data = sheet.getDataRange().getValues();
    const announcements = [];
    
    // Loop backwards to get newest first
    for (let i = data.length - 1; i > 0; i--) {
      const row = data[i];
      const status = row[2];
      
      if (status === 'Active') {
        announcements.push({
          id: row[0],
          content: row[1]
        });
      }
    }
    return announcements;
    
  } catch (e) {
    Logger.log("webGetAnnouncements Error: " + e.message);
    return []; // Return empty array on error
  }
}

/**
 * Fetches all announcements for the admin panel.
 * Only Superadmins can access this.
 */
function webGetAnnouncements_Admin() {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    
    if (userData.emailToRole[adminEmail] !== 'superadmin') {
      throw new Error("Permission denied. Only superadmins can manage announcements.");
    }

    const sheet = getOrCreateSheet(ss, SHEET_NAMES.announcements);
    const data = sheet.getDataRange().getValues();
    const results = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      results.push({
        id: row[0],
        content: row[1],
        status: row[2],
        createdBy: row[3],
        timestamp: convertDateToString(new Date(row[4]))
      });
    }
    
    return results;

  } catch (e) {
    Logger.log("webGetAnnouncements_Admin Error: " + e.message);
    return { error: e.message };
  }
}

/**
 * Saves (creates or updates) an announcement.
 * Only Superadmins can access this.
 */
function webSaveAnnouncement(announcementObject) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    
    if (userData.emailToRole[adminEmail] !== 'superadmin') {
      throw new Error("Permission denied. Only superadmins can save announcements.");
    }

    const sheet = getOrCreateSheet(ss, SHEET_NAMES.announcements);
    const { id, content, status } = announcementObject;

    if (!content) {
      throw new Error("Content cannot be empty.");
    }

    if (id) {
      // --- Update Existing ---
      const data = sheet.getDataRange().getValues();
      let rowFound = -1;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === id) {
          rowFound = i + 1;
          break;
        }
      }
      
      if (rowFound === -1) {
        throw new Error("Announcement ID not found. Could not update.");
      }
      
      sheet.getRange(rowFound, 2).setValue(content);
      sheet.getRange(rowFound, 3).setValue(status);
      
    } else {
      // --- Create New ---
      const newID = `ann-${new Date().getTime()}`;
      sheet.appendRow([
        newID,
        content,
        status,
        adminEmail,
        new Date()
      ]);
    }
    
    SpreadsheetApp.flush();
    return { success: true };

  } catch (e) {
    Logger.log("webSaveAnnouncement Error: " + e.message);
    return { error: e.message };
  }
}

/**
 * Deletes an announcement.
 * Only Superadmins can access this.
 */
function webDeleteAnnouncement(announcementID) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    
    if (userData.emailToRole[adminEmail] !== 'superadmin') {
      throw new Error("Permission denied. Only superadmins can delete announcements.");
    }

    const sheet = getOrCreateSheet(ss, SHEET_NAMES.announcements);
    const data = sheet.getDataRange().getValues();
    let rowFound = -1;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === announcementID) {
        rowFound = i + 1;
        break;
      }
    }

    if (rowFound > -1) {
      sheet.deleteRow(rowFound);
      SpreadsheetApp.flush();
      return { success: true };
    } else {
      throw new Error("Announcement not found.");
    }

  } catch (e) {
    Logger.log("webDeleteAnnouncement Error: " + e.message);
    return { error: e.message };
  }
}

/**
 * NEW: Logs a request from a user to upgrade their role.
 */
function webRequestAdminAccess(justification, requestedRole) {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);
    
    const userName = userData.emailToName[userEmail];
    const currentRole = userData.emailToRole[userEmail] || 'agent';

    if (!userName) {
      throw new Error("Your user account could not be found.");
    }
    if (currentRole === 'superadmin') {
      throw new Error("You are already a Superadmin.");
    }
    if (currentRole === 'admin' && requestedRole === 'admin') {
      throw new Error("You are already an Admin.");
    }
    if (currentRole === 'agent' && requestedRole === 'superadmin') {
      throw new Error("You must be an Admin to request Superadmin access.");
    }

    const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.roleRequests);
    const requestID = `ROLE-${new Date().getTime()}`;

    // ...
reqSheet.appendRow([
  requestID,
  userEmail,
  userName,
  currentRole,
  requestedRole,
  justification,
  new Date(),
  "Pending", // *** ADD "Pending" STATUS ***
  "",        // ActionByEmail
  ""         // ActionTimestamp
]);

    return "Your role upgrade request has been submitted for review.";

  } catch (e) {
    Logger.log("webRequestAdminAccess Error: " + e.message);
    return "Error: " + e.message;
  }
}

/**
 * Fetches pending role requests. Superadmin only.
 */
function webGetRoleRequests() {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);

    if (userData.emailToRole[adminEmail] !== 'superadmin') {
      throw new Error("Permission denied. Only superadmins can view role requests.");
    }

    const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.roleRequests);
    const data = reqSheet.getDataRange().getValues();
    const headers = data[0];
    const results = [];
    
    // Find column indexes
    const statusIndex = headers.indexOf("Status");
    const idIndex = headers.indexOf("RequestID");
    const emailIndex = headers.indexOf("UserEmail");
    const nameIndex = headers.indexOf("UserName");
    const currentIndex = headers.indexOf("CurrentRole");
    const requestedIndex = headers.indexOf("RequestedRole");
    const justifyIndex = headers.indexOf("Justification");
    const timeIndex = headers.indexOf("RequestTimestamp");

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[statusIndex] === 'Pending') {
        results.push({
          requestID: row[idIndex],
          userEmail: row[emailIndex],
          userName: row[nameIndex],
          currentRole: row[currentIndex],
          requestedRole: row[requestedIndex],
          justification: row[justifyIndex],
          timestamp: convertDateToString(new Date(row[timeIndex]))
        });
      }
    }
    return results.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)); // Newest first
  } catch (e) {
    Logger.log("webGetRoleRequests Error: " + e.message);
    return { error: e.message };
  }
}

/**
 * Approves or denies a role request. Superadmin only.
 */
function webApproveDenyRoleRequest(requestID, newStatus) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
    const userData = getUserDataFromDb(dbSheet);

    if (userData.emailToRole[adminEmail] !== 'superadmin') {
      throw new Error("Permission denied. Only superadmins can action role requests.");
    }

    const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.roleRequests);
    const data = reqSheet.getDataRange().getValues();
    const headers = data[0];

    // Find columns
    const idIndex = headers.indexOf("RequestID");
    const statusIndex = headers.indexOf("Status");
    const emailIndex = headers.indexOf("UserEmail");
    const requestedIndex = headers.indexOf("RequestedRole");
    const actionByIndex = headers.indexOf("ActionByEmail");
    const actionTimeIndex = headers.indexOf("ActionTimestamp");
    
    let rowToUpdate = -1;
    let requestDetails = {};

    for (let i = 1; i < data.length; i++) {
      if (data[i][idIndex] === requestID) {
        rowToUpdate = i + 1; // 1-based index
        requestDetails = {
          status: data[i][statusIndex],
          userEmail: data[i][emailIndex],
          newRole: data[i][requestedIndex]
        };
        break;
      }
    }

    if (rowToUpdate === -1) throw new Error("Request ID not found.");
    if (requestDetails.status !== 'Pending') throw new Error(`This request has already been ${requestDetails.status}.`);

    // 1. Update the Role Request sheet
    reqSheet.getRange(rowToUpdate, statusIndex + 1).setValue(newStatus);
    reqSheet.getRange(rowToUpdate, actionByIndex + 1).setValue(adminEmail);
    reqSheet.getRange(rowToUpdate, actionTimeIndex + 1).setValue(new Date());

    // 2. If Approved, update the Data Base
    if (newStatus === 'Approved') {
      const userDBRow = userData.emailToRow[requestDetails.userEmail];
      if (!userDBRow) {
        throw new Error(`Could not find user ${requestDetails.userEmail} in Data Base to update role.`);
      }
      // Find Role column (Column C = 3)
      dbSheet.getRange(userDBRow, 3).setValue(requestDetails.newRole);
    }
    
    SpreadsheetApp.flush();
    return { success: true, message: `Request has been ${newStatus}.` };
  } catch (e) {
    Logger.log("webApproveDenyRoleRequest Error: " + e.message);
    return { error: e.message };
  }
}

// ADD this new function to the end of your code.gs file
/**
 * Calculates and adds leave balances monthly based on hiring date.
 * This function should be run on a monthly time-based trigger.
 */
function monthlyLeaveAccrual() {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  const userData = getUserDataFromDb(dbSheet);
  const today = new Date();
  
  Logger.log("Starting monthlyLeaveAccrual trigger...");

  for (const user of userData.userList) {
    try {
      const hiringDate = userData.emailToHiringDate[user.email];
      
      // Skip if no hiring date or account is not active
      if (!hiringDate || user.accountStatus !== 'Active') {
        continue;
      }

      // Calculate years of service
      const yearsOfService = (today.getTime() - hiringDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      
      let annualDaysPerYear;
      if (yearsOfService >= 10) {
        annualDaysPerYear = 30;
      } else if (yearsOfService >= 1) {
        annualDaysPerYear = 21;
      } else {
        annualDaysPerYear = 15;
      }

      const monthlyAccrual = annualDaysPerYear / 12;
      
      const userRow = userData.emailToRow[user.email];
      if (!userRow) continue; // Should not happen, but safe check
      
      // Get Annual Balance range (Column D = 4)
      const balanceRange = dbSheet.getRange(userRow, 4); 
      const currentBalance = parseFloat(balanceRange.getValue()) || 0;
      const newBalance = currentBalance + monthlyAccrual;
      
      balanceRange.setValue(newBalance);
      
      logsSheet.appendRow([
        new Date(), 
        user.name, 
        'SYSTEM', 
        'Monthly Accrual', 
        `Added ${monthlyAccrual.toFixed(2)} days (Rate: ${annualDaysPerYear}/yr). New Balance: ${newBalance.toFixed(2)}`
      ]);

    } catch (e) {
      Logger.log(`Failed to process accrual for ${user.name}: ${e.message}`);
    }
  }
  Logger.log("Finished monthlyLeaveAccrual trigger.");
}

/**
 * REPLACED: Robustly parses a date from CSV, handling strings, numbers, and Date objects.
 */
function parseDate(dateInput) {
  if (!dateInput) return null;
  if (dateInput instanceof Date) return dateInput; // Already a date

  try {
    // Check if it's a serial number (e.g., 45576)
    if (typeof dateInput === 'number' && dateInput > 1) {
      // Google Sheets/Excel serial date (days since Dec 30, 1899)
      // Use UTC to avoid timezone issues during calculation.
      const baseDate = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30 UTC
      baseDate.setUTCDate(baseDate.getUTCDate() + dateInput);
      if (!isNaN(baseDate.getTime())) return baseDate;
    }
    
    // Check for MM/dd/yyyy format (common in US CSVs)
    if (typeof dateInput === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateInput)) {
      const parts = dateInput.split('/');
      // new Date(year, monthIndex, day)
      const newDate = new Date(parts[2], parts[0] - 1, parts[1]);
      if (!isNaN(newDate.getTime())) return newDate;
    }

    // Try standard parsing for ISO (yyyy-MM-dd) or other recognizable formats
    const newDate = new Date(dateInput);
    if (!isNaN(newDate.getTime())) return newDate;

    return null; // Invalid date
  } catch(e) {
    return null;
  }
}

/**
 * NEW: Robustly parses a time from CSV, handling strings and serial numbers (fractions).
 * Returns a string in HH:mm:ss format.
 */
function parseCsvTime(timeInput, timeZone) {
  if (timeInput === null || timeInput === undefined || timeInput === "") return ""; // Allow empty time

  try {
    // Check if it's a serial number (e.g., 0.5 for 12:00 PM)
    if (typeof timeInput === 'number' && timeInput >= 0 && timeInput <= 1) { // 1.0 is 24:00, which is 00:00
      // Handle edge case 1.0 = 00:00:00
      if (timeInput === 1) return "00:00:00"; 
      
      const totalSeconds = Math.round(timeInput * 86400);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      
      const hh = String(hours).padStart(2, '0');
      const mm = String(minutes).padStart(2, '0');
      const ss = String(seconds).padStart(2, '0');
      
      return `${hh}:${mm}:${ss}`;
    }

    // Check if it's a string (e.g., "12:00" or "12:00:00" or "12:00 PM")
    if (typeof timeInput === 'string') {
      // Try parsing as a date (handles "12:00 PM", "12:00", "12:00:00")
      const dateFromTime = new Date('1970-01-01 ' + timeInput);
      if (!isNaN(dateFromTime.getTime())) {
          return Utilities.formatDate(dateFromTime, timeZone, "HH:mm:ss");
      }
    }
    
    // Check if it's a full Date object (e.g., from a formatted cell)
    if (timeInput instanceof Date) {
      return Utilities.formatDate(timeInput, timeZone, "HH:mm:ss");
    }
    
    return ""; // Could not parse
  } catch(e) {
    Logger.log(`parseCsvTime Error for input "${timeInput}": ${e.message}`);
    return ""; // Return empty on error
  }
}

// ==========================================
// === PHASE 2: EMPLOYEE SELF-SERVICE API ===
// ==========================================

/**
 * Fetches full profile data (Core + PII) for the logged-in user.
 */
function webGetMyProfile() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const userData = getUserDataFromDb(ss); // This uses your updated Phase 1 logic
  
  // Find the user object from the list we already generated
  const user = userData.userList.find(u => u.email === userEmail);
  if (!user) throw new Error("User not found.");

  // Now fetch PII data (Phone, Address, IBAN) from the restricted sheet
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const piiData = piiSheet.getDataRange().getValues();
  
  let piiRecord = {};
  
  // Look for the row with the matching EmployeeID
  for (let i = 1; i < piiData.length; i++) {
    if (piiData[i][0] === user.empID) { // Column A is EmployeeID
      piiRecord = {
        salary: piiData[i][2],      // Col C
        iban: piiData[i][3],        // Col D
        address: piiData[i][4],     // Col E
        phone: piiData[i][5],       // Col F
        medical: piiData[i][6],     // Col G
        contract: piiData[i][7]     // Col H
      };
      break;
    }
  }

  return {
    core: user,
    pii: piiRecord
  };
}

/**
 * Updates editable profile fields (Address, Phone).
 * Sensitive fields like IBAN trigger a request (simulated for now).
 */
function webUpdateProfile(formData) {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const userData = getUserDataFromDb(ss);
  const user = userData.userList.find(u => u.email === userEmail);
  if (!user) throw new Error("User not found.");

  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const piiData = piiSheet.getDataRange().getValues();
  
  let rowToUpdate = -1;
  for (let i = 1; i < piiData.length; i++) {
    if (piiData[i][0] === user.empID) {
      rowToUpdate = i + 1;
      break;
    }
  }

  if (rowToUpdate === -1) throw new Error("PII record not found. Contact HR.");

  // Update Address (Col E -> 5) and Phone (Col F -> 6)
  if (formData.address) piiSheet.getRange(rowToUpdate, 5).setValue(formData.address);
  if (formData.phone) piiSheet.getRange(rowToUpdate, 6).setValue(formData.phone);

  // Logic for IBAN change request (For now, we just log it)
  if (formData.iban && formData.iban !== piiData[rowToUpdate-1][3]) {
     const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
     logsSheet.appendRow([new Date(), user.name, userEmail, "Profile Change Request", `Requested IBAN change to: ${formData.iban}`]);
     return "Profile updated. Note: IBAN changes require HR approval and have been logged as a request.";
  }

  return "Profile updated successfully.";
}

/**
 * Scans the user's specific Drive folder for documents.
 */
function webGetMyDocuments() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const userData = getUserDataFromDb(ss);
  const user = userData.userList.find(u => u.email === userEmail);
  
  if (!user || !user.empID) return [];

  // 1. Find the root folder
  const rootFolders = DriveApp.getFoldersByName("KOMPASS_HR_Files");
  if (!rootFolders.hasNext()) return [];
  const root = rootFolders.next();
  
  const empFolders = root.getFoldersByName("Employee_Files");
  if (!empFolders.hasNext()) return [];
  const parentFolder = empFolders.next();

  // 2. Find the specific user folder: "[Name]_[ID]"
  const searchName = `${user.name}_${user.empID}`;
  const userFolders = parentFolder.getFoldersByName(searchName);
  
  if (!userFolders.hasNext()) return [];
  const myFolder = userFolders.next();

  // 3. Recursive function to get all files
  let fileList = [];
  
  function scanFolder(folder, path) {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      fileList.push({
        name: f.getName(),
        url: f.getUrl(),
        type: path, // e.g., "Payslips" or "Root"
        date: f.getLastUpdated().toISOString()
      });
    }
    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      const sub = subFolders.next();
      scanFolder(sub, sub.getName());
    }
  }
  
  scanFolder(myFolder, "General");
  return fileList;
}

/**
 * Fetches warnings for the logged-in user.
 */
function webGetMyWarnings() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const userData = getUserDataFromDb(ss);
  const user = userData.userList.find(u => u.email === userEmail);
  
  if (!user) return [];

  const wSheet = getOrCreateSheet(ss, "Warnings"); // Ensure this matches SHEET_NAMES
  const data = wSheet.getDataRange().getValues();
  const warnings = [];

  for (let i = 1; i < data.length; i++) {
    // Col B is EmployeeID
    if (data[i][1] === user.empID) {
      warnings.push({
        type: data[i][2],
        level: data[i][3],
        date: convertDateToString(new Date(data[i][4])),
        description: data[i][5],
        status: data[i][6]
      });
    }
  }
  return warnings;
}

// ==========================================
// === PHASE 3: PROJECT MANAGEMENT API ===
// ==========================================

/**
 * Fetches all active projects.
 * Returns a list for dropdowns.
 */
function webGetProjects() {
  const ss = getSpreadsheet();
  const pSheet = getOrCreateSheet(ss, SHEET_NAMES.projects); // Defined in Phase 1
  const data = pSheet.getDataRange().getValues();
  
  const projects = [];
  // Skip header (row 0)
  for (let i = 1; i < data.length; i++) {
    // ProjectID(0), Name(1), Manager(2), Roles(3)
    if (data[i][0]) {
      projects.push({
        id: data[i][0],
        name: data[i][1],
        manager: data[i][2]
      });
    }
  }
  return projects;
}

/**
 * Admins create/update projects here.
 */
function webSaveProject(projectData) {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  
  // Security Check (Admin Only)
  // You can reuse your existing checkAdmin() helper logic here if you extracted it, 
  // or just look up the role again.
  const coreSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const users = coreSheet.getDataRange().getValues();
  let isAdmin = false;
  for(let i=1; i<users.length; i++) {
    if(users[i][2] == userEmail && (users[i][3] == 'admin' || users[i][3] == 'superadmin')) {
      isAdmin = true; break;
    }
  }
  if (!isAdmin) throw new Error("Permission denied.");

  const pSheet = getOrCreateSheet(ss, SHEET_NAMES.projects);
  
  // Generate ID if new
  const pid = projectData.id || `PRJ-${new Date().getTime()}`;
  
  // Check if updating existing
  const data = pSheet.getDataRange().getValues();
  let rowToUpdate = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === pid) {
      rowToUpdate = i + 1;
      break;
    }
  }

  if (rowToUpdate > 0) {
    pSheet.getRange(rowToUpdate, 2).setValue(projectData.name);
    pSheet.getRange(rowToUpdate, 3).setValue(projectData.manager);
  } else {
    pSheet.appendRow([pid, projectData.name, projectData.manager, "All"]);
  }
  
  return "Project saved successfully.";
}

// ==========================================
// === PHASE 4: RECRUITMENT & HIRING API ===
// ==========================================

/**
 * 3. SUBMIT APPLICATION (Public) - UPGRADED
 * Now captures National ID, Languages, Referrer, etc.
 */
function webSubmitApplication(data) {
  const ss = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
  
  const id = `CAND-${new Date().getTime()}`;
  sheet.appendRow([
    id,
    data.name,
    data.email,
    data.phone,
    data.position, // This might now be a Requisition ID or Title
    data.cv,
    "New",         // Status
    "Applied",     // Stage
    "", "", "", "",// Interview Scores/Notes (Placeholders)
    new Date(),    // Applied Date
    // --- NEW PHASE 3 COLUMNS ---
    data.nationalId || "",
    data.langLevel || "",
    data.secondLang || "",
    data.referrer || "",
    "", "", "", "", // Feedback Columns (HR, Mgmt, Tech, Client)
    "Pending"       // Offer Status
  ]);
  return "Success";
}

/**
 * ADMIN: Gets candidates from Internal DB AND External Buffer
 */
function webGetCandidates() {
  const ss = getSpreadsheet();
  const internalSheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
  const candidates = [];

  // 1. Fetch Internal Candidates (Historical/Processing)
  const internalData = internalSheet.getDataRange().getValues();
  for (let i = 1; i < internalData.length; i++) {
    candidates.push({
      id: internalData[i][0],
      name: internalData[i][1],
      email: internalData[i][2],
      position: internalData[i][4],
      cv: internalData[i][5],
      status: internalData[i][6],
      stage: internalData[i][7],
      date: convertDateToString(new Date(internalData[i][12])),
      source: 'Internal'
    });
  }

  // 2. Fetch New Candidates from External Buffer
  try {
    const bufferSs = SpreadsheetApp.openById(BUFFER_SHEET_ID);
    const bufferSheet = bufferSs.getSheets()[0];
    const bufferData = bufferSheet.getDataRange().getValues();
    
    // Start loop from 1 to skip headers
    for (let i = 1; i < bufferData.length; i++) {
      // Buffer Columns: ID(0), Name(1), Email(2), Phone(3), Pos(4), CV(5), Status(6), Date(7)
      // We only show "New" ones. Processed ones should be moved/deleted.
      candidates.push({
        id: bufferData[i][0],
        name: bufferData[i][1],
        email: bufferData[i][2],
        position: bufferData[i][4],
        cv: bufferData[i][5],
        status: "New (External)", // Mark as new
        stage: "Applied",
        date: convertDateToString(new Date(bufferData[i][7])),
        source: 'Buffer',
        phone: bufferData[i][3] // Store for importing
      });
    }
  } catch (e) {
    Logger.log("Could not read buffer sheet (permissions?): " + e.message);
  }

  // Sort by newest
  return candidates.reverse();
}

/**
 * ADMIN: Updates Candidate. 
 * If source is Buffer, it IMPORTS them to Internal DB first.
 */
function webUpdateCandidateStatus(candidateId, newStatus, newStage) {
  const ss = getSpreadsheet();
  const internalSheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
  
  // 1. Check if candidate is already Internal
  const internalData = internalSheet.getDataRange().getValues();
  for (let i = 1; i < internalData.length; i++) {
    if (internalData[i][0] === candidateId) {
      if (newStatus) internalSheet.getRange(i + 1, 7).setValue(newStatus);
      if (newStage) internalSheet.getRange(i + 1, 8).setValue(newStage);
      return "Updated";
    }
  }

  // 2. If not found, check External Buffer and Import
  try {
    const bufferSs = SpreadsheetApp.openById(BUFFER_SHEET_ID);
    const bufferSheet = bufferSs.getSheets()[0];
    const bufferData = bufferSheet.getDataRange().getValues();
    
    for (let i = 1; i < bufferData.length; i++) {
      if (bufferData[i][0] === candidateId) {
        // FOUND in Buffer! Import to Internal.
        const row = bufferData[i];
        
        internalSheet.appendRow([
          row[0], // ID
          row[1], // Name
          row[2], // Email
          row[3], // Phone
          row[4], // Position
          row[5], // CV
          newStatus || row[6], // New Status
          newStage || "Applied", // New Stage
          "", "", "", "", 
          row[7] // Date
        ]);
        
        // Remove from Buffer to prevent duplicates
        bufferSheet.deleteRow(i + 1);
        return "Imported & Updated";
      }
    }
  } catch (e) {
    throw new Error("Error importing from buffer: " + e.message);
  }
  
  throw new Error("Candidate not found in Internal DB or Buffer.");
}

/**
 * ADMIN: HIRES A CANDIDATE
 * 1. Creates entry in Employees_Core
 * 2. Creates entry in Employees_PII
 * 3. Creates Google Drive Folders
 * 4. Updates Candidate status to "Hired"
 */
function webHireCandidate(candidateId, hiringData) {
  const ss = getSpreadsheet();
  const candSheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
  const coreSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);

  // A. Find Candidate
  const candData = candSheet.getDataRange().getValues();
  let candRow = -1;
  let candidate = null;
  
  // Dynamically map headers
  const candHeaders = candData[0];
  const cIdx = {
    id: candHeaders.indexOf("CandidateID"),
    name: candHeaders.indexOf("Name"),
    email: candHeaders.indexOf("Email"),
    phone: candHeaders.indexOf("Phone"),
    natId: candHeaders.indexOf("NationalID")
  };

  for (let i = 1; i < candData.length; i++) {
    if (candData[i][cIdx.id] === candidateId) {
      candRow = i + 1;
      candidate = {
        name: candData[i][cIdx.name],
        email: candData[i][cIdx.email],
        phone: candData[i][cIdx.phone],
        nationalId: candData[i][cIdx.natId]
      };
      break;
    }
  }
  
  if (!candidate) throw new Error("Candidate not found.");

  // B. Generate Employee ID
  const lastRow = coreSheet.getLastRow();
  const newEmpId = `KOM-${1000 + lastRow}`;

  // C. Create CORE Record (Active Status - Skips Registration)
  coreSheet.appendRow([
    newEmpId,
    hiringData.fullName || candidate.name,
    hiringData.konectaEmail,
    'agent',
    'Active', // Auto-active
    hiringData.directManager,
    hiringData.functionalManager,
    0, 0, 0, // Balances
    hiringData.gender,
    hiringData.empType,
    hiringData.contractType,
    hiringData.jobLevel,
    hiringData.department,
    hiringData.function,
    hiringData.subFunction,
    hiringData.gcm,
    hiringData.scope,
    hiringData.shore,
    hiringData.dottedManager,
    hiringData.projectManager,
    hiringData.bonusPlan,
    hiringData.nLevel,
    "", 
    "Active"
  ]);

  // D. Create PII Record (With Basic + Variable Split)
  piiSheet.appendRow([
    newEmpId,
    hiringData.hiringDate,
    hiringData.salary, // Total Salary
    hiringData.iban,
    hiringData.address,
    candidate.phone,
    "", "", 
    candidate.nationalId,
    hiringData.passport,
    hiringData.socialInsurance,
    hiringData.birthDate,
    candidate.email,
    hiringData.maritalStatus,
    hiringData.dependents,
    hiringData.emergencyContact,
    hiringData.emergencyRelation,
    hiringData.salary, 
    hiringData.hourlyRate,
    hiringData.variable // New Variable Pay Column
  ]);

  // E. Create Drive Folders
  try {
    const rootFolders = DriveApp.getFoldersByName("KOMPASS_HR_Files");
    if (rootFolders.hasNext()) {
      const root = rootFolders.next();
      const empFolders = root.getFoldersByName("Employee_Files");
      if (empFolders.hasNext()) {
        const parent = empFolders.next();
        const personalFolder = parent.createFolder(`${candidate.name}_${newEmpId}`);
        personalFolder.createFolder("Payslips");
        personalFolder.createFolder("Onboarding_Docs");
        personalFolder.createFolder("Sick_Notes");
      }
    }
  } catch (e) { Logger.log("Folder creation error: " + e.message); }

  // F. Update Candidate Status
  candSheet.getRange(candRow, 7).setValue("Hired"); // Status
  candSheet.getRange(candRow, 8).setValue("Onboarding"); // Stage

  return `Successfully hired ${candidate.name}. Employee ID: ${newEmpId}`;
}

/**
 * ======================================================================
 * PHASE 5 DATABASE UPGRADE SCRIPT (FIXED)
 * ACTION: RUN THIS FUNCTION AGAIN.
 * PURPOSE: Expands existing sheets and creates new ones for the HRIS system.
 * ======================================================================
 */
function _SETUP_PHASE_5_DATABASE() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log("Starting Phase 5 Database Upgrade...");

  // --- 1. CREATE NEW SHEETS ---
  
  // 1.1 Requisitions (Job Openings)
  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.requisitions);
  // FIX: Check if lastRow is 0 (new sheet) OR 1 (potentially empty header)
  if (reqSheet.getLastRow() === 0 || (reqSheet.getLastRow() === 1 && reqSheet.getRange("A1").getValue() === "")) {
    reqSheet.getRange("A1:H1").setValues([[
      "ReqID", "Title", "Department", "HiringManager", "OpenDate", 
      "Status", "PoolCandidates", "JobDescription"
    ]]);
    reqSheet.setFrozenRows(1);
    Logger.log("Created 'Requisitions' sheet with headers.");
  }

  // 1.2 Performance Reviews
  const perfSheet = getOrCreateSheet(ss, SHEET_NAMES.performance);
  if (perfSheet.getLastRow() === 0 || (perfSheet.getLastRow() === 1 && perfSheet.getRange("A1").getValue() === "")) {
    perfSheet.getRange("A1:G1").setValues([[
      "ReviewID", "EmployeeID", "Year", "ReviewPeriod", "Rating", 
      "ManagerComments", "Date"
    ]]);
    perfSheet.setFrozenRows(1);
    Logger.log("Created 'Performance_Reviews' sheet with headers.");
  }

  // 1.3 Employee History (Promotions/Transfers)
  const histSheet = getOrCreateSheet(ss, SHEET_NAMES.historyLogs);
  if (histSheet.getLastRow() === 0 || (histSheet.getLastRow() === 1 && histSheet.getRange("A1").getValue() === "")) {
    histSheet.getRange("A1:F1").setValues([[
      "HistoryID", "EmployeeID", "Date", "EventType", 
      "OldValue", "NewValue"
    ]]);
    histSheet.setFrozenRows(1);
    Logger.log("Created 'Employee_History' sheet with headers.");
  }

  // --- 2. EXPAND EXISTING SHEETS ---

  // 2.1 Expand Employees_Core
  const coreSheet = ss.getSheetByName(SHEET_NAMES.employeesCore);
  if (coreSheet) {
    const newCoreCols = [
      "Gender", "EmploymentType", "ContractType", "JobLevel", "Department",
      "Function", "SubFunction", "GCMLevel", "Scope", "OffshoreOnshore",
      "DottedManager", "ProjectManagerEmail", "BonusPlan", "N_Level", 
      "ExitDate", "Status" 
    ];
    addColumnsToSheet(coreSheet, newCoreCols);
    Logger.log("Updated 'Employees_Core' with new HR columns.");
  } else {
    Logger.log("ERROR: Employees_Core sheet not found. Run Phase 1 setup first.");
  }

  // 2.2 Expand Employees_PII
  const piiSheet = ss.getSheetByName(SHEET_NAMES.employeesPII);
  if (piiSheet) {
    const newPiiCols = [
      "NationalID", "PassportNumber", "SocialInsuranceNumber", "BirthDate",
      "PersonalEmail", "MaritalStatus", "DependentsInfo", "EmergencyContact",
      "EmergencyRelation", "Salary", "HourlyRate"
    ];
    addColumnsToSheet(piiSheet, newPiiCols);
    
    // Set Date Format for BirthDate column
    try {
      const headers = piiSheet.getRange(1, 1, 1, piiSheet.getLastColumn()).getValues()[0];
      const dobIndex = headers.indexOf("BirthDate") + 1;
      if (dobIndex > 0) piiSheet.getRange(2, dobIndex, piiSheet.getMaxRows(), 1).setNumberFormat("yyyy-mm-dd");
    } catch (e) {
      Logger.log("Could not set date format (sheet might be empty): " + e.message);
    }
    
    Logger.log("Updated 'Employees_PII' with new sensitive columns.");
  }

  // 2.3 Update Recruitment_Candidates
  const recSheet = ss.getSheetByName(SHEET_NAMES.recruitment);
  if (recSheet) {
    const newRecCols = [
      "NationalID", "LanguageLevel", "SecondLanguage", "Referrer", 
      "HR_Feedback", "Management_Feedback", "Technical_Feedback", 
      "Client_Feedback", "OfferStatus"
    ];
    addColumnsToSheet(recSheet, newRecCols);
    Logger.log("Updated 'Recruitment_Candidates' with feedback columns.");
  }

  Logger.log("Phase 5 Database Upgrade Complete!");
}

/**
 * HELPER: specific to this upgrade script.
 * Adds missing columns to the end of a sheet's header row.
 * FIX: Handles empty sheets correctly.
 */
function addColumnsToSheet(sheet, newHeaders) {
  const lastCol = sheet.getLastColumn();

  // Case 1: Sheet is completely empty
  if (lastCol === 0) {
    if (newHeaders.length > 0) {
      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
    }
    return;
  }

  // Case 2: Sheet has existing data, append only new columns
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const headersToAdd = [];

  newHeaders.forEach(header => {
    if (!currentHeaders.includes(header)) {
      headersToAdd.push(header);
    }
  });

  if (headersToAdd.length > 0) {
    // Append to the next available column
    sheet.getRange(1, lastCol + 1, 1, headersToAdd.length).setValues([headersToAdd]);
  }
}
function debugDatabaseMapping() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Employees_Core");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  Logger.log("--- DEBUGGING HEADERS ---");
  Logger.log("All Headers: " + headers.join(", "));
  
  const dmIndex = headers.indexOf("DirectManagerEmail");
  const pmIndex = headers.indexOf("ProjectManagerEmail");
  
  Logger.log(`DirectManagerEmail Index: ${dmIndex} (Should be > -1)`);
  Logger.log(`ProjectManagerEmail Index: ${pmIndex} (Should be > -1)`);
  
  if (dmIndex === -1 || pmIndex === -1) {
    Logger.log("❌ CRITICAL ERROR: One or both manager headers are missing or misspelled!");
    return;
  }

  // Check the first user row (Row 2)
  if (data.length > 1) {
    const row = data[1];
    Logger.log("--- SAMPLE USER DATA (Row 2) ---");
    Logger.log(`Name: ${row[headers.indexOf("Name")]}`);
    Logger.log(`Email: ${row[headers.indexOf("Email")]}`);
    Logger.log(`Direct Manager Value: '${row[dmIndex]}'`);
    Logger.log(`Project Manager Value: '${row[pmIndex]}'`);
  }
}

// ==========================================
// === PHASE 3: RECRUITMENT & ONBOARDING  ===
// ==========================================

/**
 * 1. CREATE REQUISITION (Admin)
 * Opens a new job position in the 'Requisitions' sheet.
 */
function webCreateRequisition(data) {
  const ss = getSpreadsheet();
  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.requisitions);
  const reqID = `REQ-${new Date().getTime()}`; // Unique Job ID
  
  reqSheet.appendRow([
    reqID,
    data.title,
    data.department,
    data.hiringManager, // Email of the manager
    new Date(),         // Open Date
    "Open",             // Status
    "",                 // Pool Candidates (Empty start)
    data.description
  ]);
  return "Requisition opened successfully: " + reqID;
}

/**
 * 2. GET OPEN REQUISITIONS (Public & Admin)
 * Returns list of open jobs for the dropdown in Recruitment.html
 */
function webGetOpenRequisitions() {
  const ss = getSpreadsheet();
  const reqSheet = getOrCreateSheet(ss, SHEET_NAMES.requisitions);
  const data = reqSheet.getDataRange().getValues();
  const jobs = [];
  
  for (let i = 1; i < data.length; i++) {
    // Col F (Index 5) is Status
    if (data[i][5] === 'Open') {
      jobs.push({
        id: data[i][0],
        title: data[i][1],
        dept: data[i][2]
      });
    }
  }
  return jobs;
}

// ==========================================
// === PHASE 4: PROFILE & SELF-SERVICE API ===
// ==========================================

/**
 * 1. GET FULL PROFILE (Core + PII)
 * Fetches all data points for the "My Profile" tab.
 */
function webGetMyProfile() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const userData = getUserDataFromDb(ss); // This already reads Core columns
  
  // Find user in the loaded list
  const userCore = userData.userList.find(u => u.email === userEmail);
  if (!userCore) throw new Error("User profile not found.");

  // Fetch Extended PII Data
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const piiData = piiSheet.getDataRange().getValues();
  let piiRecord = {};

  // Find PII row by EmployeeID
  for (let i = 1; i < piiData.length; i++) {
    if (piiData[i][0] === userCore.empID) {
      piiRecord = {
        hiringDate: convertDateToString(parseDate(piiData[i][1])),
        salary: piiData[i][2],       // Confidential
        iban: piiData[i][3],         // Confidential
        address: piiData[i][4],
        phone: piiData[i][5],
        medical: piiData[i][6],
        contractLink: piiData[i][7],
        nationalId: piiData[i][8],   // New Phase 5 Col
        passport: piiData[i][9],
        socialInsurance: piiData[i][10],
        birthDate: convertDateToString(parseDate(piiData[i][11])),
        personalEmail: piiData[i][12],
        maritalStatus: piiData[i][13],
        dependents: piiData[i][14],
        emergencyContact: piiData[i][15],
        emergencyRelation: piiData[i][16]
      };
      break;
    }
  }

  // Calculate Age
  let age = "N/A";
  if (piiRecord.birthDate) {
    const dob = new Date(piiRecord.birthDate);
    const diff_ms = Date.now() - dob.getTime();
    const age_dt = new Date(diff_ms); 
    age = Math.abs(age_dt.getUTCFullYear() - 1970);
  }

  // Fetch additional Core fields that getUserDataFromDb might not have exposed in the simplified list
  // We can re-read the row from the Core Sheet directly to be safe, or rely on getUserDataFromDb if we updated it fully.
  // Let's just return what we have, assuming getUserDataFromDb is robust.
  // If you find fields missing, we can add a direct read here.

  return {
    core: {
      ...userCore, // Includes Name, ID, Role, Managers, Balances
      // You might need to explicitly map the new Phase 5 Core columns if getUserDataFromDb doesn't return them in the object
      // For now, let's assume basic data. If you need specifically "JobLevel" or "GCM", we should ensure getUserDataFromDb returns them.
    },
    pii: {
      ...piiRecord,
      age: age
    }
  };
}

/**
 * 2. UPDATE PROFILE (Self-Service)
 * Allows users to update: Phone, Address, Emergency Contact, Personal Email.
 * Sensitive fields (IBAN, Name) trigger a request log.
 */
function webUpdateProfile(formData) {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  
  const user = userData.userList.find(u => u.email === userEmail);
  if (!user) throw new Error("User not found.");

  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const piiData = piiSheet.getDataRange().getValues();
  let rowToUpdate = -1;

  for (let i = 1; i < piiData.length; i++) {
    if (piiData[i][0] === user.empID) {
      rowToUpdate = i + 1;
      break;
    }
  }
  if (rowToUpdate === -1) throw new Error("PII record not found.");

  // Update Allowed Fields
  // Address (Col E = 5)
  if (formData.address) piiSheet.getRange(rowToUpdate, 5).setValue(formData.address);
  // Phone (Col F = 6)
  if (formData.phone) piiSheet.getRange(rowToUpdate, 6).setValue(formData.phone);
  // Personal Email (Col M = 13)
  if (formData.personalEmail) piiSheet.getRange(rowToUpdate, 13).setValue(formData.personalEmail);
  // Emergency Contact (Col P = 16)
  if (formData.emergencyContact) piiSheet.getRange(rowToUpdate, 16).setValue(formData.emergencyContact);
  // Emergency Relation (Col Q = 17)
  if (formData.emergencyRelation) piiSheet.getRange(rowToUpdate, 17).setValue(formData.emergencyRelation);

  // Log Restricted Changes (IBAN, Marital Status)
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  
  // Check IBAN change (Col D = 4)
  const currentIBAN = piiData[rowToUpdate-1][3];
  if (formData.iban && formData.iban !== String(currentIBAN)) {
    logsSheet.appendRow([new Date(), user.name, userEmail, "Data Change Request", `Requested IBAN change to: ${formData.iban}`]);
    return "Profile updated. Note: IBAN change has been sent to HR for approval.";
  }

  return "Profile updated successfully.";
}

// ==========================================
// === PHASE 5: PERFORMANCE & OFFBOARDING ===
// ==========================================

// 3. Updated Performance Review
function webSubmitPerformanceReview(reviewData) {
  // Checks if user has permission to submit reviews
  const { userEmail: adminEmail, userData, ss } = getAuthorizedContext('SUBMIT_PERFORMANCE');
  
  const targetEmail = reviewData.employeeEmail.toLowerCase();
  
  // Contextual Check: Can only review OWN team (unless Superadmin)
  const targetSupervisor = userData.emailToSupervisor[targetEmail];
  const targetProjectMgr = userData.emailToProjectManager[targetEmail];
  const adminRole = userData.emailToRole[adminEmail];

  const isAuthorized = (adminRole === 'superadmin') || 
                       (targetSupervisor === adminEmail) || 
                       (targetProjectMgr === adminEmail);

  if (!isAuthorized) throw new Error("Permission denied. You can only review your own team members.");

  const targetUser = userData.userList.find(u => u.email === targetEmail);
  if (!targetUser) throw new Error("Employee not found.");

  const perfSheet = getOrCreateSheet(ss, SHEET_NAMES.performance);
  perfSheet.appendRow([
    `REV-${new Date().getTime()}`,
    targetUser.empID,
    reviewData.year,
    reviewData.period,
    reviewData.rating,
    reviewData.comments,
    new Date()
  ]);

  return "Performance review submitted successfully.";
}

/**
 * 2. GET PERFORMANCE HISTORY (Employee/Manager)
 * Returns list of past reviews for a specific user.
 */
function webGetPerformanceHistory(targetEmail) {
  const viewerEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.database);
  const userData = getUserDataFromDb(dbSheet);
  
  const emailToFetch = targetEmail || viewerEmail;
  const viewerRole = userData.emailToRole[viewerEmail] || 'agent';

  // Security Check: Agents can only see their own. Managers can see team's.
  if (viewerRole === 'agent' && emailToFetch !== viewerEmail) {
    throw new Error("Permission denied.");
  }

  // Get Employee ID
  const targetUser = userData.userList.find(u => u.email === emailToFetch);
  if (!targetUser) return []; // No user found

  const perfSheet = getOrCreateSheet(ss, SHEET_NAMES.performance);
  const data = perfSheet.getDataRange().getValues();
  const reviews = [];

  // Columns: ReviewID(0), EmpID(1), Year(2), Period(3), Rating(4), Comments(5), Date(6)
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === targetUser.empID) {
      reviews.push({
        id: data[i][0],
        year: data[i][2],
        period: data[i][3],
        rating: data[i][4],
        comments: data[i][5],
        date: convertDateToString(new Date(data[i][6]))
      });
    }
  }
  
  return reviews.reverse(); // Newest first
}

// 1. Updated Offboarding
function webOffboardEmployee(offboardData) {
  // Replaces hardcoded check with dynamic RBAC
  const { userEmail: adminEmail, userData, ss } = getAuthorizedContext('OFFBOARD_EMPLOYEE');

  const targetEmail = offboardData.email.toLowerCase();
  const row = userData.emailToRow[targetEmail];
  if (!row) throw new Error("User not found.");

  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const headers = dbSheet.getRange(1, 1, 1, dbSheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf("Status") + 1;
  const exitDateCol = headers.indexOf("ExitDate") + 1;

  if (statusCol > 0) dbSheet.getRange(row, statusCol).setValue("Left");
  if (exitDateCol > 0) dbSheet.getRange(row, exitDateCol).setValue(offboardData.exitDate);

  // Log History
  const histSheet = getOrCreateSheet(ss, SHEET_NAMES.historyLogs);
  const targetUser = userData.userList.find(u => u.email === targetEmail);
  histSheet.appendRow([
    `HIST-${new Date().getTime()}`,
    targetUser ? targetUser.empID : "UNKNOWN",
    new Date(),
    "Termination/Exit",
    "Active",
    "Left"
  ]);

  return `Successfully offboarded ${targetEmail}. Status set to 'Left'.`;
}

// --- JOB REQUISITION MANAGEMENT ---

function webGetRequisitions(filterStatus) {
  try {
    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.requisitions);
    const data = sheet.getDataRange().getValues();
    const jobs = [];
    
    // Skip header
    for (let i = 1; i < data.length; i++) {
      const status = data[i][5];
      if (filterStatus === 'All' || status === filterStatus) {
        jobs.push({
          id: data[i][0],
          title: data[i][1],
          dept: data[i][2],
          manager: data[i][3],
          date: convertDateToString(new Date(data[i][4])),
          status: status,
          desc: data[i][7]
        });
      }
    }
    return jobs.reverse();
  } catch (e) { return { error: e.message }; }
}

function webManageRequisition(reqId, action, newData) {
  try {
    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.requisitions);
    const data = sheet.getDataRange().getValues();
    let rowIdx = -1;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === reqId) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) throw new Error("Requisition not found");

    if (action === 'Archive') {
      sheet.getRange(rowIdx, 6).setValue('Archived');
    } else if (action === 'Edit') {
      if(newData.title) sheet.getRange(rowIdx, 2).setValue(newData.title);
      if(newData.dept) sheet.getRange(rowIdx, 3).setValue(newData.dept);
      if(newData.desc) sheet.getRange(rowIdx, 8).setValue(newData.desc);
    }
    return "Success";
  } catch (e) { return "Error: " + e.message; }
}

// --- CANDIDATE WORKFLOW & AUTOMATION ---

function webGetCandidateHistory(email) {
  try {
    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
    const data = sheet.getDataRange().getValues();
    const history = [];
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][2]).toLowerCase() === email.toLowerCase()) {
        history.push({
          position: data[i][4],
          date: convertDateToString(new Date(data[i][9])), // AppliedDate
          status: data[i][6],
          stage: data[i][7]
        });
      }
    }
    return history;
  } catch (e) { return []; }
}

function webSendRejectionEmail(candidateId, reason, sendEmail) {
  try {
    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
    const data = sheet.getDataRange().getValues();
    let rowIdx = -1;
    let candidate = {};

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === candidateId) { 
        rowIdx = i + 1; 
        candidate = { name: data[i][1], email: data[i][2], pos: data[i][4] };
        break; 
      }
    }
    if (rowIdx === -1) throw new Error("Candidate not found");

    // Update Sheet
    // Col 7 = Status, Col 8 = Stage, Col 20 = RejectionReason (New)
    sheet.getRange(rowIdx, 7).setValue("Rejected");
    sheet.getRange(rowIdx, 8).setValue("Disqualified");
    // Assuming RejectionReason is column 20 (Index 19) based on fixer schema
    // Dynamically find index just in case
    const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    const reasonIdx = headers.indexOf("RejectionReason");
    if (reasonIdx > -1) sheet.getRange(rowIdx, reasonIdx + 1).setValue(reason);

    if (sendEmail) {
      const subject = `Update regarding your application for ${candidate.pos}`;
      const body = `Dear ${candidate.name},\n\nThank you for your interest in the ${candidate.pos} position at Konecta. After careful consideration, we have decided to move forward with other candidates whose qualifications more closely match our current needs.\n\nWe wish you the best in your job search.\n\nBest regards,\nKonecta HR Team`;
      
      MailApp.sendEmail({ to: candidate.email, subject: subject, body: body });
      return "Rejection recorded & Email sent.";
    }
    return "Rejection recorded (No email sent).";
  } catch (e) { return "Error: " + e.message; }
}

function webSendOfferLetter(candidateId, offerDetails) {
  try {
    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.recruitment);
    const data = sheet.getDataRange().getValues();
    let candidate = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === candidateId) {
        candidate = { name: data[i][1], email: data[i][2], pos: data[i][4] };
        break;
      }
    }
    if (!candidate) throw new Error("Candidate not found");

    const subject = `Job Offer: ${candidate.pos} at Konecta`;
    const body = `Dear ${candidate.name},\n\nWe are pleased to offer you the position of ${candidate.pos} at Konecta!\n\n` +
                 `**Start Date:** ${offerDetails.startDate}\n` +
                 `**Basic Salary:** ${offerDetails.basic}\n` +
                 `**Variable/Bonus:** ${offerDetails.variable}\n\n` +
                 `Please reply to this email to accept this offer.\n\nBest regards,\nKonecta HR`;

    MailApp.sendEmail({ to: candidate.email, subject: subject, body: body });
    return "Offer letter sent to " + candidate.email;
  } catch (e) { return "Error: " + e.message; }
}


// ==========================================
// === PHASE 6.3: PAYROLL & FINANCE HUB ===
// ==========================================

/**
 * USER: Get My Financial Profile & Entitlements
 */
function webGetMyFinancials() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getSpreadsheet();
  const userData = getUserDataFromDb(ss);
  
  const userCore = userData.userList.find(u => u.email === userEmail);
  if (!userCore) throw new Error("User not found.");

  // 1. Get Salary Breakdown from PII
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const piiData = piiSheet.getDataRange().getValues();
  const piiHeaders = piiData[0];
  
  // Map Indexes
  const idx = {
    empId: piiHeaders.indexOf("EmployeeID"),
    basic: piiHeaders.indexOf("BasicSalary"),
    variable: piiHeaders.indexOf("VariablePay"),
    hourly: piiHeaders.indexOf("HourlyRate"),
    total: piiHeaders.indexOf("Salary")
  };

  let salaryInfo = { basic: 0, variable: 0, total: 0 };

  for (let i = 1; i < piiData.length; i++) {
    if (piiData[i][idx.empId] === userCore.empID) {
      salaryInfo = {
        basic: piiData[i][idx.basic] || "Not Set",
        variable: piiData[i][idx.variable] || "Not Set",
        total: piiData[i][idx.total] || "Not Set"
      };
      break;
    }
  }

  // 2. Get Entitlements (Bonuses, Overtime)
  const finSheet = getOrCreateSheet(ss, SHEET_NAMES.financialEntitlements);
  const finData = finSheet.getDataRange().getValues();
  const entitlements = [];

  for (let i = 1; i < finData.length; i++) {
    // Col 1 = EmployeeEmail
    if (String(finData[i][1]).toLowerCase() === userEmail) {
      entitlements.push({
        type: finData[i][3],
        amount: finData[i][4],
        currency: finData[i][5],
        date: convertDateToString(new Date(finData[i][6])), // Due Date
        status: finData[i][7],
        desc: finData[i][8]
      });
    }
  }

  return { salary: salaryInfo, entitlements: entitlements.reverse() };
}

/**
 * ADMIN: Submit a Single Entitlement
 */
function webSubmitEntitlement(data) {
  try {
    const { userEmail: adminEmail, userData, ss } = getAuthorizedContext('MANAGE_FINANCE');
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.financialEntitlements);
    
    const targetEmail = data.email.toLowerCase();
    const userObj = userData.userList.find(u => u.email === targetEmail);
    const targetName = userObj ? userObj.name : targetEmail;
    const id = `FIN-${new Date().getTime()}`;
    
    sheet.appendRow([id, targetEmail, targetName, data.type, data.amount, "EGP", new Date(data.date), "Pending", data.desc, adminEmail, new Date()]);
    return "Entitlement added successfully.";
  } catch (e) { return "Error: " + e.message; }
}

/**
 * ADMIN: Bulk Upload Entitlements via CSV Data
 * Expected CSV: Email, Type, Amount, Date, Description
 */
function webUploadEntitlementsCSV(csvData) {
  try {
    const adminEmail = Session.getActiveUser().getEmail().toLowerCase();
    checkFinancialPermission(adminEmail);

    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.financialEntitlements);
    const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
    const userData = getUserDataFromDb(dbSheet); // To map emails to names

    let count = 0;
    
    csvData.forEach(row => {
      // row is { Email: '...', Type: '...', Amount: ... }
      if (!row.Email || !row.Amount) return;
      
      const targetEmail = row.Email.toLowerCase();
      const userObj = userData.userList.find(u => u.email === targetEmail);
      const targetName = userObj ? userObj.name : targetEmail;
      const id = `FIN-${new Date().getTime()}-${Math.floor(Math.random()*1000)}`;

      sheet.appendRow([
        id,
        targetEmail,
        targetName,
        row.Type || "Bonus",
        row.Amount,
        "EGP",
        new Date(row.Date || new Date()),
        "Pending",
        row.Description || "Bulk Upload",
        adminEmail,
        new Date()
      ]);
      count++;
    });

    return `Successfully processed ${count} records.`;
  } catch (e) { return "Error: " + e.message; }
}

// --- Helper: Permission Check ---
function checkFinancialPermission(email) {
  const ss = getSpreadsheet();
  const dbSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesCore);
  const userData = getUserDataFromDb(dbSheet);
  const role = userData.emailToRole[email];
  
  if (role !== 'financial_manager' && role !== 'superadmin') {
    throw new Error("Permission denied. Financial Manager access required.");
  }
}

/**
 * PHASE 6.5: COACHING HIERARCHY FIX
 * Returns a list of {name, email} for users the current user is allowed to coach.
 * - Superadmin: Returns All Users
 * - Admin/Manager: Returns their full downstream hierarchy (Direct + Indirect)
 * - Agent: Returns empty list
 */
function webGetCoachableUsers() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase();
    const ss = getSpreadsheet();
    const userData = getUserDataFromDb(ss);
    const userRole = userData.emailToRole[userEmail];

    let targetEmails = new Set();

    if (userRole === 'superadmin') {
       // Superadmins can coach everyone
       userData.userList.forEach(u => targetEmails.add(u.email));
    } 
    else if (userRole === 'admin' || userRole === 'manager' || userRole === 'financial_manager') {
       // Managers coach their hierarchy
       // Reuse the existing hierarchy walker
       const hierarchyEmails = webGetAllSubordinateEmails(userEmail); 
       hierarchyEmails.forEach(e => targetEmails.add(e));
       
       // Remove the manager themselves from the list (optional, but usually you coach others)
       if (targetEmails.has(userEmail)) targetEmails.delete(userEmail);
    } 
    else {
       return []; // Agents don't coach
    }

    // Map emails to Name/Email objects for the frontend dropdown
    const result = [];
    targetEmails.forEach(email => {
       const u = userData.userList.find(user => user.email === email);
       if (u) {
         result.push({ name: u.name, email: u.email });
       }
    });

    // Sort Alphabetically
    return result.sort((a, b) => a.name.localeCompare(b.name));

  } catch (e) {
    Logger.log("webGetCoachableUsers Error: " + e.message);
    return [];
  }
}

// ==========================================================
// === PHASE 6.6: SMART RBAC ENGINE ===
// ==========================================================

/**
 * 🧠 SMART CONTEXT: The only line you need at the start of a function.
 * Usage: const { userEmail, userData, ss } = getAuthorizedContext('MANAGE_FINANCE');
 */
function getAuthorizedContext(requiredPermission) {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Use existing helper to get all data
  const userData = getUserDataFromDb(ss);
  const userRole = userData.emailToRole[userEmail] || 'agent';

  // If a permission is required, check it
  if (requiredPermission) {
    const permissionsMap = getPermissionsMap(ss);
    
    // 1. Check if permission exists in DB
    if (!permissionsMap[requiredPermission]) {
      console.warn(`Warning: Permission '${requiredPermission}' not found in RBAC sheet.`);
      throw new Error(`Access Denied: Permission check failed (${requiredPermission}).`);
    }

    // 2. Check if user's role has this permission
    const hasAccess = permissionsMap[requiredPermission][userRole];
    
    if (!hasAccess) {
      throw new Error(`Permission Denied: You need '${requiredPermission}' access.`);
    }
  }

  return { 
    userEmail: userEmail, 
    userName: userData.emailToName[userEmail],
    userRole: userRole,
    userData: userData,
    ss: ss 
  };
}

/**
 * Helper: Reads and Caches the RBAC Sheet
 */
function getPermissionsMap(ss) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("RBAC_MAP_V1");
  if (cached) return JSON.parse(cached);

  const sheet = getOrCreateSheet(ss, SHEET_NAMES.rbac);
  const data = sheet.getDataRange().getValues();
  const headers = data[0]; // [ID, Desc, superadmin, admin, manager, financial_manager, agent]
  const map = {};

  for (let i = 1; i < data.length; i++) {
    const permID = data[i][0];
    map[permID] = {};
    for (let c = 2; c < headers.length; c++) {
      const role = headers[c];
      map[permID][role] = String(data[i][c]).toUpperCase() === 'TRUE';
    }
  }

  cache.put("RBAC_MAP_V1", JSON.stringify(map), 600); // Cache for 10 mins
  return map;
}



// ==========================================
// === PHASE 7: HR ADMIN & PII TOOLS ===
// ==========================================

/**
 * ADMIN: Search for an employee to edit their PII.
 * Returns Core data merged with PII data.
 */
function webSearchEmployeePII(query) {
  const { userEmail, userData, ss } = getAuthorizedContext('OFFBOARD_EMPLOYEE'); // Reusing a high-level HR permission
  
  const lowerQuery = query.toLowerCase().trim();
  const targetUser = userData.userList.find(u => 
    u.email.includes(lowerQuery) || u.name.toLowerCase().includes(lowerQuery)
  );

  if (!targetUser) throw new Error("User not found.");

  // Fetch PII Data
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const piiData = piiSheet.getDataRange().getValues();
  const piiHeaders = piiData[0];
  
  let piiRow = {};
  const empIdIdx = piiHeaders.indexOf("EmployeeID");
  
  for (let i = 1; i < piiData.length; i++) {
    if (piiData[i][empIdIdx] === targetUser.empID) {
      // Map all headers to the row values
      piiHeaders.forEach((header, index) => {
        let value = piiData[i][index];
        // Format dates
        if (value instanceof Date) value = convertDateToString(value).split('T')[0];
        piiRow[header] = value;
      });
      break;
    }
  }

  return {
    core: targetUser,
    pii: piiRow
  };
}

/**
 * ADMIN: Update PII fields for an employee.
 */
function webUpdateEmployeePII(empID, formData) {
  const { userEmail: adminEmail, ss } = getAuthorizedContext('OFFBOARD_EMPLOYEE');
  
  const piiSheet = getOrCreateSheet(ss, SHEET_NAMES.employeesPII);
  const data = piiSheet.getDataRange().getValues();
  const headers = data[0];
  
  let rowIndex = -1;
  // Find row by EmployeeID (Col A)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === empID) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) throw new Error("Employee PII record not found.");

  // Update fields dynamically based on formData keys matching headers
  // We only allow specific editable fields for safety
  const allowedFields = [
    "NationalID", "IBAN", "PassportNumber", "SocialInsuranceNumber", 
    "Address", "Phone", "PersonalEmail", "MaritalStatus", 
    "EmergencyContact", "EmergencyRelation", "BasicSalary", "VariablePay"
  ];

  const updates = [];

  for (const [key, value] of Object.entries(formData)) {
    if (allowedFields.includes(key)) {
      const colIndex = headers.indexOf(key);
      if (colIndex > -1) {
        piiSheet.getRange(rowIndex, colIndex + 1).setValue(value);
        updates.push(`${key}: ${value}`);
      }
    }
  }

  // Log changes
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  logsSheet.appendRow([
    new Date(),
    `ID: ${empID}`,
    adminEmail,
    "Admin PII Update",
    `Updated: ${updates.join(', ')}`
  ]);

  return "Employee data updated successfully.";
}

/**
 * ADMIN: Get pending data change requests (from Logs).
 */
function webGetPendingDataChanges() {
  const { ss } = getAuthorizedContext('OFFBOARD_EMPLOYEE');
  const logsSheet = getOrCreateSheet(ss, SHEET_NAMES.logs);
  const data = logsSheet.getDataRange().getValues();
  const requests = [];

  // Loop backwards to see newest first
  for (let i = data.length - 1; i > 0; i--) {
    const row = data[i];
    // Look for "Data Change Request" or "Profile Change Request"
    if (row[3] === "Data Change Request" || row[3] === "Profile Change Request") {
      requests.push({
        date: convertDateToString(new Date(row[0])),
        user: row[1],
        email: row[2],
        details: row[4]
      });
    }
    // Limit to last 20 requests to keep it snappy
    if (requests.length >= 20) break;
  }
  return requests;
}



// ==========================================
// === PHASE 8: OVERTIME MANAGEMENT API ===
// ==========================================

/**
 * AGENT: Request Overtime
 */
function webSubmitOvertimeRequest(requestData) {
  const { userEmail, userData, ss } = getAuthorizedContext(null);
  const otSheet = getOrCreateSheet(ss, SHEET_NAMES.overtime);
  
  const shiftDate = new Date(requestData.date);
  
  // 1. Validate Schedule
  const schedule = getScheduleForDate(userEmail, shiftDate);
  if (!schedule || !schedule.end) {
    throw new Error("No schedule found for this date. Cannot request overtime.");
  }

  const reqID = `OT-${new Date().getTime()}`;
  
  otSheet.appendRow([
    reqID,
    userData.userList.find(u=>u.email === userEmail)?.empID || "",
    userData.userName,
    shiftDate,
    new Date(schedule.start),
    new Date(schedule.end),
    requestData.hours,
    requestData.reason,
    "Pending",
    "", // Manager Comment
    "", // Action By
    ""  // Action Date
  ]);
  
  return "Overtime request submitted.";
}

/**
 * MANAGER: Get Overtime Requests (Pending or All)
 */
function webGetOvertimeRequests(filterStatus) {
  const { userEmail, userData, ss } = getAuthorizedContext(null); // Check logic inside
  const otSheet = getOrCreateSheet(ss, SHEET_NAMES.overtime);
  const data = otSheet.getDataRange().getValues();
  
  const results = [];
  // Col Indexes: 0:ID, 1:EmpID, 2:Name, 3:Date, 4:Start, 5:End, 6:Hours, 7:Reason, 8:Status
  
  // Permissions check
  const isManager = (userData.userRole === 'manager' || userData.userRole === 'admin' || userData.userRole === 'superadmin');
  const mySubordinates = isManager ? new Set(webGetAllSubordinateEmails(userEmail)) : new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[8];
    const empName = row[2]; // We don't store email in OT sheet? We should have.
    // Fix: I missed storing Email in webSubmitOvertimeRequest. 
    // Let's assume we filter by Name match or add Email column. 
    // Ideally, adding Email column is best. 
    // For now, let's match strictly by hierarchy if manager, or self if agent.
    
    // To make it robust, let's fix the appendRow in webSubmitOvertimeRequest first?
    // Actually, let's just fetch the EmpID and look up the email from userData.
    const empID = row[1];
    const userObj = userData.userList.find(u => u.empID === empID);
    const rowEmail = userObj ? userObj.email : "";

    let canView = false;
    
    if (isManager) {
      if (userData.userRole === 'superadmin') canView = true;
      else if (mySubordinates.has(rowEmail)) canView = true;
    } else {
      if (rowEmail === userEmail) canView = true; // Agent sees own
    }

    if (canView) {
      if (filterStatus === 'All' || status === filterStatus) {
        results.push({
          id: row[0],
          name: row[2],
          date: convertDateToString(new Date(row[3])).split('T')[0],
          plannedEnd: row[5] ? Utilities.formatDate(new Date(row[5]), Session.getScriptTimeZone(), "HH:mm") : "N/A",
          hours: row[6],
          reason: row[7],
          status: status,
          comment: row[9]
        });
      }
    }
  }
  return results.reverse();
}

/**
 * MANAGER: Approve/Deny or Pre-Approve
 */
function webActionOvertime(reqId, action, comment, preApproveData) {
  const { userEmail, ss } = getAuthorizedContext('MANAGE_OVERTIME');
  const otSheet = getOrCreateSheet(ss, SHEET_NAMES.overtime);
  
  // CASE 1: Pre-Approval (Creating a new Approved request)
  if (action === 'Pre-Approve') {
    const targetEmail = preApproveData.email;
    const userData = getUserDataFromDb(ss);
    const targetUser = userData.userList.find(u => u.email === targetEmail);
    if (!targetUser) throw new Error("User not found.");
    
    const schedule = getScheduleForDate(targetEmail, new Date(preApproveData.date));
    if (!schedule) throw new Error("No schedule found for user on this date.");

    const newID = `OT-PRE-${new Date().getTime()}`;
    otSheet.appendRow([
      newID,
      targetUser.empID,
      targetUser.name,
      new Date(preApproveData.date),
      new Date(schedule.start),
      new Date(schedule.end),
      preApproveData.hours,
      "Pre-Approved by Manager",
      "Approved",
      comment || "Pre-approved",
      userEmail,
      new Date()
    ]);
    return "Overtime pre-approved successfully.";
  }

  // CASE 2: Action Existing Request
  const data = otSheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === reqId) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error("Request not found.");
  
  // Update Status (Col I = 9), Comment (Col J = 10), ActionBy (Col K = 11), ActionDate
  otSheet.getRange(rowIndex, 9).setValue(action); // Approved/Denied
  otSheet.getRange(rowIndex, 10).setValue(comment);
  otSheet.getRange(rowIndex, 11).setValue(userEmail);
  otSheet.getRange(rowIndex, 12).setValue(new Date());
  
  return `Request ${action}.`;
}

/**
 * NEW PHASE 5: Calculates net working hours (Total Login Duration - Excess Break Time).
 * Returns decimal hours (e.g., 8.5).
 */
function calculateNetHours(punches) {
  if (!punches.login || !punches.logout) return 0;

  const totalDurationSec = timeDiffInSeconds(punches.login, punches.logout);
  
  // Helper to calculate excess
  const getExcess = (start, end, type) => {
    if (!start || !end) return 0;
    const duration = timeDiffInSeconds(start, end);
    const allowed = getBreakConfig(type).default;
    return Math.max(0, duration - allowed);
  };

  const deduct1 = getExcess(punches.firstBreakIn, punches.firstBreakOut, "First Break");
  const deductLunch = getExcess(punches.lunchIn, punches.lunchOut, "Lunch");
  const deduct2 = getExcess(punches.lastBreakIn, punches.lastBreakOut, "Last Break");

  const netSeconds = totalDurationSec - deduct1 - deductLunch - deduct2;
  return (netSeconds / 3600).toFixed(2); // Return decimal hours
}

// ================= PHASE 6: CONFIGURATION API =================

/**
 * Fetches the current break configuration for the Admin Editor.
 */
function webGetBreakConfig() {
  const { userEmail, userData, ss } = getAuthorizedContext('MANAGE_BALANCES'); // Reusing Admin permission
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.breakConfig);
  const data = sheet.getDataRange().getValues();
  
  // Skip header row
  const configs = [];
  for (let i = 1; i < data.length; i++) {
    configs.push({
      type: data[i][0],
      defaultDur: data[i][1], // Seconds
      maxDur: data[i][2]      // Seconds
    });
  }
  return configs;
}

/**
 * Saves changes to the Break Configuration sheet.
 */
function webSaveBreakConfig(newConfigs) {
  const { userEmail, userData, ss } = getAuthorizedContext('MANAGE_BALANCES');
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.breakConfig);
  const data = sheet.getDataRange().getValues();
  
  // newConfigs is an array of { type, defaultDur, maxDur }
  newConfigs.forEach(conf => {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === conf.type) {
        // Update Default (Col B) and Max (Col C)
        sheet.getRange(i + 1, 2).setValue(Number(conf.defaultDur));
        sheet.getRange(i + 1, 3).setValue(Number(conf.maxDur));
        break;
      }
    }
  });
  
  return "Break configuration updated successfully.";
}



//.............................................................................................................................







function _MASTER_DB_FIXER() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log("Starting Master DB Fixer...");

  // 1. Define Schema
  const schema = {
    [SHEET_NAMES.rbac]: ["PermissionID", "Description", "superadmin", "admin", "manager", "financial_manager", "agent"],
    [SHEET_NAMES.employeesCore]: ["EmployeeID", "Name", "Email", "Role", "AccountStatus", "DirectManagerEmail", "FunctionalManagerEmail", "AnnualBalance", "SickBalance", "CasualBalance", "Gender", "EmploymentType", "ContractType", "JobLevel", "Department", "Function", "SubFunction", "GCMLevel", "Scope", "OffshoreOnshore", "DottedManager", "ProjectManagerEmail", "BonusPlan", "N_Level", "ExitDate", "Status"],
    [SHEET_NAMES.employeesPII]: ["EmployeeID", "HiringDate", "Salary", "IBAN", "Address", "Phone", "MedicalInfo", "ContractType", "NationalID", "PassportNumber", "SocialInsuranceNumber", "BirthDate", "PersonalEmail", "MaritalStatus", "DependentsInfo", "EmergencyContact", "EmergencyRelation", "BasicSalary", "VariablePay", "HourlyRate"],
    [SHEET_NAMES.financialEntitlements]: ["EntitlementID", "EmployeeEmail", "EmployeeName", "Type", "Amount", "Currency", "DueDate", "Status", "Description", "AddedBy", "DateAdded"],
    [SHEET_NAMES.pendingRegistrations]: ["RequestID", "UserEmail", "UserName", "DirectManagerEmail", "FunctionalManagerEmail", "DirectStatus", "FunctionalStatus", "Address", "Phone", "RequestTimestamp", "HiringDate", "WorkflowStage"],
    [SHEET_NAMES.recruitment]: ["CandidateID", "Name", "Email", "Phone", "Position", "CV_Link", "Status", "Stage", "InterviewScores", "AppliedDate", "NationalID", "LangLevel", "SecondLang", "Referrer", "HR_Feedback", "Mgmt_Feedback", "Tech_Feedback", "Client_Feedback", "OfferStatus", "RejectionReason", "HistoryLog"],
    [SHEET_NAMES.requisitions]: ["ReqID", "Title", "Department", "HiringManager", "OpenDate", "Status", "PoolCandidates", "JobDescription"],
    [SHEET_NAMES.performance]: ["ReviewID", "EmployeeID", "Year", "ReviewPeriod", "Rating", "ManagerComments", "Date"],
    [SHEET_NAMES.historyLogs]: ["HistoryID", "EmployeeID", "Date", "EventType", "OldValue", "NewValue"],
    [SHEET_NAMES.adherence]: ["Date", "User Name", "Login", "First Break In", "First Break Out", "Lunch In", "Lunch Out", "Last Break In", "Last Break Out", "Logout", "Tardy (Seconds)", "Overtime (Seconds)", "Early Leave (Seconds)", "Leave Type", "Admin Audit", "—", "1st Break Exceed", "Lunch Exceed", "Last Break Exceed", "Absent", "Admin Code"],
    [SHEET_NAMES.schedule]: ["Name", "StartDate", "ShiftStartTime", "EndDate", "ShiftEndTime", "LeaveType", "agent email"],
    [SHEET_NAMES.logs]: ["Timestamp", "User Name", "Email", "Action", "Time"],
    [SHEET_NAMES.otherCodes]: ["Date", "User Name", "Code", "Time In", "Time Out", "Duration (Seconds)", "Admin Audit (Email)"],
    [SHEET_NAMES.warnings]: ["WarningID", "EmployeeID", "Type", "Level", "Date", "Description", "Status", "IssuedBy"],
    [SHEET_NAMES.coachingSessions]: ["SessionID", "AgentEmail", "AgentName", "CoachEmail", "CoachName", "SessionDate", "WeekNumber", "OverallScore", "FollowUpComment", "SubmissionTimestamp", "FollowUpDate", "FollowUpStatus", "AgentAcknowledgementTimestamp"],
    [SHEET_NAMES.coachingScores]: ["SessionID", "Category", "Criteria", "Score", "Comment"],
    [SHEET_NAMES.coachingTemplates]: ["TemplateName", "Category", "Criteria", "Status"],
    [SHEET_NAMES.leaveRequests]: ["RequestID", "Status", "RequestedByEmail", "RequestedByName", "LeaveType", "StartDate", "EndDate", "TotalDays", "Reason", "ActionDate", "ActionBy", "SupervisorEmail", "ActionReason", "SickNoteURL", "DirectManagerSnapshot", "ProjectManagerSnapshot"],
    [SHEET_NAMES.movementRequests]: ["MovementID", "Status", "UserToMoveEmail", "UserToMoveName", "FromSupervisorEmail", "ToSupervisorEmail", "RequestTimestamp", "ActionTimestamp", "ActionByEmail", "RequestedByEmail"],
    [SHEET_NAMES.roleRequests]: ["RequestID", "UserEmail", "UserName", "CurrentRole", "RequestedRole", "Justification", "RequestTimestamp", "Status", "ActionByEmail", "ActionTimestamp"],
    [SHEET_NAMES.projects]: ["ProjectID", "ProjectName", "ProjectManagerEmail", "AllowedRoles"],
    [SHEET_NAMES.projectLogs]: ["LogID", "EmployeeID", "ProjectID", "Date", "HoursLogged"],
    [SHEET_NAMES.announcements]: ["AnnouncementID", "Content", "Status", "CreatedByEmail", "Timestamp"],
    [SHEET_NAMES.assets]: ["AssetID", "Type", "AssignedTo_EmployeeID", "DateAssigned", "Status"],
    [SHEET_NAMES.overtime]: ["RequestID", "EmployeeID", "EmployeeName", "ShiftDate", "PlannedStart", "PlannedEnd", "RequestedHours", "Reason", "Status", "ManagerComment", "ActionBy", "ActionDate"]
  };

  // 2. Run Fixer
  for (const [sheetName, headers] of Object.entries(schema)) {
    let sheet = getOrCreateSheet(ss, sheetName);
    const lastCol = sheet.getLastColumn();
    let currentHeaders = [];
    
    // Only fetch headers if the sheet is not empty
    if (lastCol > 0) {
      currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    }

    const missingCols = [];
    headers.forEach(h => { if (!currentHeaders.includes(h)) missingCols.push(h); });

    if (missingCols.length > 0) {
      // Append to the next available column (startCol = 1 if empty, else lastCol + 1)
      const startCol = lastCol === 0 ? 1 : lastCol + 1;
      sheet.getRange(1, startCol, 1, missingCols.length).setValues([missingCols]);
      Logger.log(`Updated ${sheetName}: Added [${missingCols.join(', ')}]`);
    }
  }

  // 3. Populate Permissions (RBAC)
  const rbacSheet = ss.getSheetByName(SHEET_NAMES.rbac);
  if (rbacSheet.getLastRow() <= 1) {
    const permissions = [
      ["PUNCH_OTHERS", "Clock in others", true, true, true, false, false],
      ["EDIT_SCHEDULE", "Manage Schedules", true, true, true, false, false],
      ["APPROVE_LEAVE", "Approve Leave", true, true, true, false, false],
      ["MANAGE_BALANCES", "Edit Leave Balances", true, true, false, false, false],
      ["MANAGE_RECRUITMENT", "Hire/Reject Candidates", true, false, false, false, false],
      ["HIRE_EMPLOYEE", "Finalize Hiring", true, false, false, false, false],
      ["OFFBOARD_EMPLOYEE", "Terminate Staff", true, true, false, false, false],
      ["SUBMIT_COACHING", "Perform Coaching", true, true, true, false, false],
      ["MANAGE_TEMPLATES", "Edit Coaching Forms", true, true, false, false, false],
      ["MANAGE_FINANCE", "Payroll/Bonuses", true, false, false, true, false],
      ["MANAGE_PROJECTS", "Create Projects", true, true, false, false, false],
      ["MANAGE_ANNOUNCEMENTS", "Post Announcements", true, false, false, false, false],
      ["VIEW_FULL_DASHBOARD", "See Team Stats", true, true, true, false, false],
      ["MANAGE_HIERARCHY", "Move Reporting Lines", true, true, false, false, false],
      ["MANAGE_RBAC", "Edit Permissions", true, false, false, false, false],
      ["SUBMIT_PERFORMANCE", "Submit Reviews", true, true, true, false, false], // Added for Phase 5
      ["MANAGE_OVERTIME", "Approve/Pre-approve Overtime", true, true, true, false, false] // NEW PHASE 8
    ];
    rbacSheet.getRange(2, 1, permissions.length, 7).setValues(permissions);
    Logger.log("RBAC Permissions Populated.");
  }
  
  Logger.log("Master DB Fix Complete.");
}
