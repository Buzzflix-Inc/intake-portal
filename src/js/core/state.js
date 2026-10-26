const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authForm = document.getElementById("authForm");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authMsg = document.getElementById("authMsg");

let isAdmin = false;
let profileMap = new Map();
let currentCompany = null;

let currentUserId = null;
let currentUserEmail = null;
let allTemplates = [];
let approvalChainSteps = [];
