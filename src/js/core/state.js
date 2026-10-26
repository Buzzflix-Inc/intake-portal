const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authSub = document.getElementById("authSub");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authMsg = document.getElementById("authMsg");
const toggleModeBtn = document.getElementById("toggleModeBtn");
const toggleLabel = document.getElementById("toggleLabel");

let mode = "signin";
let isAdmin = false;
let profileMap = new Map();
let currentCompany = null;

let currentUserId = null;
let currentUserEmail = null;
let allTemplates = [];
let approvalChainSteps = [];
