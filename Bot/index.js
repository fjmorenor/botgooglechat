import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import { Firestore } from "@google-cloud/firestore";
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'; 
import { Base64 } from 'js-base64'; 

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
// --- REQUIRED ENVIRONMENT VARIABLES ---
const DELEGATED_ADMIN_EMAIL = process.env.DELEGATED_ADMIN_EMAIL;
const DOMAIN = process.env.DOMAIN;
const NOTIFICATION_EMAIL_RECIPIENT = process.env.NOTIFICATION_EMAIL_RECIPIENT;
const COMPANY_NAME = process.env.COMPANY_NAME; 
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID; 
const SECRET_NAME = process.env.SECRET_NAME; 
// ----------------------------------------

const BOT_VERSION = "2.8.36-Welcome-Fix"; 

// --- Generic Fallback Message ---
const FALLBACK_GENERAL_MESSAGE = 
    "❌ I can only help you manage Google Groups. Please indicate a valid action or type **\"Menu\"** to see your available options.";

// --- Firestore Initialization ---
const firestore = new Firestore({ databaseId: 'databasechat' });

// --- Gemini Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
let groupManagementPrompt = "";
let knowledgeBaseText = ""; 
let faqDataArray = [];      
let arePromptsLoaded = false;

// --- Secret Manager Client ---
const secretManagerClient = new SecretManagerServiceClient();
const secretName = `projects/${GCP_PROJECT_ID}/secrets/${SECRET_NAME}/versions/latest`; 

// --- Admin SDK / Gmail SDK Authentication ---
let admin;
let auth;
let gmail; 

async function getAdminSdkCredentials() {
    try {
        console.log(`LOG: Accessing secret: ${secretName}`);
        const [version] = await secretManagerClient.accessSecretVersion({
            name: secretName,
        });
        const payload = version.payload.data.toString('utf8');
        const credentials = JSON.parse(payload);
        console.log("LOG: Credentials successfully retrieved from Secret Manager.");
        return credentials;
    } catch (error) {
        console.error("--- FATAL ERROR OBTAINING CREDENTIALS ---", error);
        process.exit(1);
    }
}

function initializeAdminSdk(credentials) {
    auth = google.auth.fromJSON(credentials);
    auth.subject = DELEGATED_ADMIN_EMAIL;
    auth.scopes = [
        "https://www.googleapis.com/auth/admin.directory.group.member",
        "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
        "https://www.googleapis.com/auth/admin.directory.group.readonly",
        "https://www.googleapis.com/auth/admin.directory.group",
        "https://www.googleapis.com/auth/admin.directory.user.readonly",
        "https://www.googleapis.com/auth/gmail.send" 
    ];
    admin = google.admin({ version: "directory_v1", auth });
    gmail = google.gmail({ version: 'v1', auth }); 
    console.log("LOG: Admin and Gmail SDK initialized with Secret Manager credentials.");
}


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ----------------------------------------------------------------
// UTILITY AND NAME RESOLUTION FUNCTIONS
// ----------------------------------------------------------------

function getWelcomeMenuResponse() {
    return {
        text: `👋 Hello! I am **Bot Omega**, your IT Agent for **${COMPANY_NAME}** Workspace.

I execute limited **Google Group Administration** tasks directly via this chat.

### ⚙️ Quick Group Management Commands

| Action | Description | Quick Example |
| :--- | :--- | :--- |
| **Add** | Adds users to a group. | \`/add user@ to group.test@\` |
| **Remove** | Removes users from a group. | \`/remove user@ from group.test@\` |
| **Manager** | Promotes a member to Manager role. | \`/make user@ manager of group@\` |
| **Members** | Lists all members of a group. | \`/members support@\` |
| **Leave** | Removes yourself from a group. | \`/leave office.group@\` |
| **MyGroups** | Lists groups you belong to. | \`/mygroups\` |
| **Request Manager** | Formal request for Manager permissions. | \`/request manager of group.test@\` |

> 💡 **Tip:** You can use user names (e.g., "Juan Pérez") or partial emails (e.g., "support@") without the full domain.

---

For support or questions, contact support@dominio.com`
    };
}


function completeEmail(email) {
    if (typeof email === 'string' && email.endsWith('@')) return email + DOMAIN;
    if (typeof email === 'string' && email.includes('@') && !email.includes('.')) return email + DOMAIN; 
    return email;
}

async function getUserDisplayName(userEmail) {
    try {
        const user = await admin.users.get({ userKey: userEmail });
        return user.data.name?.fullName || userEmail;
    } catch (err) {
        return userEmail;
    }
}

async function getGroupName(groupEmail) {
    try {
        const group = await admin.groups.get({ groupKey: groupEmail });
        return group.data.name || groupEmail; 
    } catch (err) {
        if (err.code === 404) {
            throw new Error("GROUP_NOT_FOUND");
        }
        throw err; 
    }
}

async function resolveUserEmailByDisplayName(displayNameOrKey) {
    if (typeof displayNameOrKey !== 'string') return displayNameOrKey;

    const input = displayNameOrKey.trim();
    const inputLower = input.toLowerCase(); 

    console.log(`LOG-RESOLVER: Attempting to resolve input: '${input}'`);

    if (input.includes('@')) {
        const fullEmail = completeEmail(input);
        try {
            const user = await admin.users.get({ userKey: fullEmail });
            console.log(`LOG-RESOLVER: Success. Returned: ${user.data.primaryEmail}`);
            return user.data.primaryEmail; 
        } catch (err) {
            return fullEmail;
        }
    }
    
    try {
        console.log(`LOG-RESOLVER: Searching key: ${inputLower}`); 
        const user = await admin.users.get({ userKey: inputLower }); 
        return user.data.primaryEmail;
    } catch (err) {
        console.log(`LOG-RESOLVER: Searching Display Name`);
        try {
            const inputClean = input.trim();
            const queryName = inputClean.replace(/\s+/g, '+'); 
            
            let response = await admin.users.list({
                domain: DOMAIN,
                query: `name:'${queryName}*'`, 
                maxResults: 1
            });

            if (response.data.users?.length) {
                return response.data.users[0].primaryEmail;
            } 
            
            const firstWord = inputClean.split(' ')[0];
            if (firstWord !== inputClean) {
                response = await admin.users.list({
                    domain: DOMAIN,
                    query: `name:'${firstWord}*'`, 
                    maxResults: 1
                });
                
                if (response.data.users?.length) {
                    return response.data.users[0].primaryEmail;
                }
            }
        } catch (innerErr) {
             console.error(`LOG-RESOLVER: FATAL ERROR in Display Name search:`, innerErr);
        }
        
        console.log(`LOG-RESOLVER: Final Fallback. Returning original input: ${input}`);
        return input; 
    }
}


async function loadConfigFromFirestore() {
    let attempts = 0;
    while (attempts < 3 && !arePromptsLoaded) {
        attempts++;
        try {
            const botCollectionSnap = await firestore.collection('Collection Bot').limit(1).get();
            if (!botCollectionSnap.empty && botCollectionSnap.docs[0].data() && botCollectionSnap.docs[0].data()['chat-omega']) {
                const docData = botCollectionSnap.docs[0].data();
                const basePrompt = docData['chat-omega'];
                const examplesToAdd = `\n--- User: "{{user_input}}" JSON Response:`;
                groupManagementPrompt = basePrompt.replace('--- Usuario: "{{user_input}}" Respuesta JSON:', examplesToAdd);
                console.log("LOG-PROMPT: Group management prompt loaded.");
            } else {
                console.error("ERROR-PROMPT: 'chat-omega' document not found or empty.");
                groupManagementPrompt = `... (Prompt fallback)`;
            }

            const faqSnapshot = await firestore.collection('faq').limit(1).get(); 
            let faqArray = [];

            if (faqSnapshot.empty) {
                console.error("LOG-FAQ: 'faq' collection empty or inaccessible.");
            } else {
                const docData = faqSnapshot.docs[0].data();
                const rawFaqString = docData.faq_documentation || docData[Object.keys(docData).find(k => k.includes('faq'))]; 
                
                if (typeof rawFaqString === 'string' && rawFaqString.length > 10) {
                    try {
                        faqArray = JSON.parse(rawFaqString); 
                        
                        if (Array.isArray(faqArray) && faqArray.length > 0) {
                            faqDataArray = faqArray;

                            knowledgeBaseText = faqArray.map(item => {
                                const questions = (item.preguntas || []).join(', ');
                                const steps = (item.pasos_detallados || []).join(' * ');
                                const standardAnswer = item.respuesta_estandar || item.respuestaestandar || 'N/A';
                                return `Category: ${item.categoria}. Question: "${questions}". Standard Answer: "${standardAnswer}". Detailed Steps: * ${steps}`;
                            }).join('\n\n---\n\n');

                            console.log(`LOG-FAQ: Base loaded with ${faqArray.length} FAQs via query.`);
                        } else {
                            console.warn("LOG-FAQ: FAQ loaded but is not a valid array or is empty.");
                        }
                    } catch (parseError) {
                        console.error("ERROR-FAQ: Failed to parse JSON (Query Document):", parseError.message);
                    }
                }
            }
            
            arePromptsLoaded = true;
        } catch (error) {
            console.error(`Error loading from Firestore:`, error);
            if (attempts < 3) {
                await delay(5000);
            } else {
                arePromptsLoaded = true;
                groupManagementPrompt = `... (Critical fallback)`;
                knowledgeBaseText = "";
            }
        }
    }
}


function getDeterministicFaqAnswer(userInput) {
    if (faqDataArray.length === 0) return null;

    const queryLower = userInput.toLowerCase().trim();
    
    const significantQueryWords = queryLower
        .split(/\s+/)
        .filter(word => word.length >= 4); 
    
    for (const item of faqDataArray) {
        
        const searchPoolTexts = [
            (item.categoria || '').toLowerCase(),
            (item.respuesta_estandar || item.respuestaestandar || '').toLowerCase(),
            ...(item.preguntas || []).map(q => q.toLowerCase()),
            ...(item.keywords || []).map(k => k.toLowerCase())
        ];

        
        const matchFullQuery = searchPoolTexts.some(faq_text => 
            faq_text.includes(queryLower) || queryLower.includes(faq_text)
        );
        
        const matchSignificantWords = significantQueryWords.some(word => 
            searchPoolTexts.some(faq_text => faq_text.includes(word))
        );
        
        const isMatch = matchFullQuery || matchSignificantWords;

        if (isMatch) {
            console.log(`LOG-FAQ-DETERMINISTIC: Match found for: "${userInput}" in FAQ ID: ${item.id}`);
            
            const steps = (item.pasos_detallados || []).join('\n* ');
            const standardAnswer = item.respuesta_estandar || item.respuestaestandar || 'Not Available';
            
            let formattedResponse = `${standardAnswer}.\n\n`;
            if (steps.trim()) {
                formattedResponse += `Detailed Steps:\n* ${steps}`;
            }

            formattedResponse += `\n\nIf the problem persists or you need further assistance, please contact support@dominio.com`;
            return formattedResponse;
        }
    }

    return null;
}


async function getFaqAnswerFromAI(userInput) {
    if (!arePromptsLoaded) return "NOT_LOADED_YET";
    
    const deterministicAnswer = getDeterministicFaqAnswer(userInput);

    if (deterministicAnswer) {
        console.log(`LOG-FAQ-SUCCESS: Deterministic Answer found for: "${userInput}".`);
    } else {
        console.log(`LOG-FAQ-FAIL: Deterministic Fail for: "${userInput}". Attempting Semantic Fallback (Gemini).`);
    }

    if (deterministicAnswer) {
        return deterministicAnswer; 
    }
      
    if (!knowledgeBaseText || knowledgeBaseText.length > 5000 || !GEMINI_API_KEY) {
        return "NO_ENCONTRADO"; 
    } 

    const faqPrompt = `You are an expert technical support assistant. Your only task is to answer the user's question using the provided KNOWLEDGE BASE exclusively. If the answer is there, respond clearly and concisely, formatting titles with bold (*Detailed Steps:*, *Alternative Solutions:*). If it is not, respond *exactly* with "NO_ENCONTRADO". At the end of EVERY answer (except if it's NO_ENCONTRADO), always add the phrase: "If the problem persists or you need further assistance, please contact support@dominio.com."

--- KNOWLEDGE BASE ---
${knowledgeBaseText}
---
User: "${userInput}"
Answer:`;
    
    console.log(`LOG-PROMPT-LENGTH: Total FAQ prompt length sent to Gemini: ${faqPrompt.length} characters.`);

    try {
        const payload = { contents: [{ parts: [{ text: faqPrompt }] }] };
        const response = await fetch(GEMINI_API_URL, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            console.error(`LOG-FAQ-API: Error in Gemini API. Status: ${response.status} ${response.statusText}`);
            return "NO_ENCONTRADO"; 
        }
        
        const result = await response.json();
        let answer = result.candidates?.[0]?.content?.parts?.[0]?.text || "NO_ENCONTRADO";
        
        if (answer === "NO_ENCONTRADO") {
            console.warn(`LOG-FAQ-API: Gemini returned NO_ENCONTRADO for query: "${userInput}" (Semantic Fail)`);
        }

        if (answer !== "NO_ENCONTRADO" && !answer.includes("support@dominio.com")) { 
            answer += "\n\nIf the problem persists or you need further assistance, please contact support@dominio.com."; 
        }

        return answer;
    } catch (error) {
        console.error("Error in getFaqAnswerFromAI:", error);
        return "NO_ENCONTRADO";
    }
}


async function getGroupIntentFromAI(userInput) {
    if (!arePromptsLoaded || !groupManagementPrompt || !GEMINI_API_KEY) return { operation: "NONE", reply_text: "AI configuration not ready." };

    const intentPrompt = groupManagementPrompt.replace("{{user_input}}", userInput);

    try {
        const payload = {
            contents: [{ parts: [{ text: intentPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const response = await fetch(GEMINI_API_URL, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Gemini API Error (Intent): ${response.statusText}`);
        const result = await response.json();
        const jsonString = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (jsonString) {
            try {
                const cleanJsonString = jsonString.replace(/^```json\s*|s*```$/g, '').trim();
                const parsedJson = JSON.parse(cleanJsonString);
                
                console.log(`LOG-AI-INTENT: JSON parsed from Gemini: ${JSON.stringify(parsedJson)}`); 
                
                return parsedJson;
            } catch (parseError) {
                console.error("DEBUG: Error parsing JSON from Gemini (Intent):", parseError, "String:", jsonString);
                return { operation: "NONE", reply_text: "The AI returned an unexpected response." };
            }
        }
        return { operation: "NONE" };
    } catch (error) {
        console.error("DEBUG: Fatal error in getGroupIntentFromAI:", error);
        return { operation: "NONE", reply_text: "There was a problem contacting the AI to interpret the intent." };
    }
}

async function checkManagerPermission(groupKey, userKey) {
    console.log(`LOG-DEBUG-PERMISSIONS-CHECK: Group: ${groupKey}, UserKey: ${userKey}`);
    
    if (!userKey) {
        console.error("ERROR-PERMISSION: userKey is null or undefined in checkManagerPermission.");
        throw new Error("USER_KEY_MISSING_IN_PERMISSION_CHECK"); 
    }
    
    try {
        const member = await admin.members.get({ groupKey: groupKey, memberKey: userKey });
        return ["MANAGER", "OWNER"].includes(member.data.role);
    } catch (err) {
        if (err.code === 404) {
            try {
                await admin.groups.get({ groupKey: groupKey });
                return false;
            } catch (groupErr) {
                if (groupErr.code === 404) {
                    throw new Error("GROUP_NOT_FOUND");
                }
                throw groupErr;
            }
        }
        throw err;
    }
}

async function sendManagerRequestEmail(requesterEmail, requesterName, groupEmail, groupName) {
    const TO = NOTIFICATION_EMAIL_RECIPIENT;
    const FROM = DELEGATED_ADMIN_EMAIL;
    
    const SUBJECT_CLEAN = `📞 MANAGER ROLE Request 📞`; 
    const encodedSubject = `=?UTF-8?B?${Base64.encode(SUBJECT_CLEAN)}?=`; 
    
    const BODY = `
User ${requesterName} has requested to be MANAGER of group ${groupName}.

Request Details:
- Requester: ${requesterName} (${requesterEmail})
- Group: ${groupName} (${groupEmail})

Please access the administration console to review and approve the request.
`;

    const raw = [
        `To: ${TO}`,
        `Subject: ${encodedSubject}`, 
        `From: ${FROM}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        '',
        BODY
    ].join('\n');

    try {
        await gmail.users.messages.send({
            userId: 'me', 
            requestBody: {
                raw: Base64.encodeURI(raw)
            }
        });
        console.log(`LOG-EMAIL: Request successfully sent to ${TO}`);
        return true;
    } catch (error) {
        console.error("LOG-EMAIL: Error sending Manager request email:", error);
        return false;
    }
}

async function listAllGroupMembers() {
    console.log("LOG: list_all_members command executed.");
    return "Global listing logic not implemented or only available to the super-admin.";
}


// --- Main Endpoint ---
app.post("/", async (req, res) => {
    if (!admin) {
        return res.json({ text: "The bot is still starting up, please wait." });
    }

    const event = req.body;
    const eventType = event.type;
    
    if (eventType === "ADDED_TO_SPACE") {
        return res.json(getWelcomeMenuResponse());
    }

    const userEmail = event.user?.email || event.message?.sender?.email;
    if (!userEmail) {
        console.error("ERROR-FATAL: Could not get user email from the event.");
        return res.status(400).send("No user email found in the event."); 
    }

    let command = null;
    let users = [];
    let groupKey = null;
    let text = "";
    const flexibleEmailRegex = /[\w._%+-]+@(?:[\w.-]+\.[a-zA-Z]{2,})?|[\w._%+-]+@/g; 
    let isFromAI = false;

    if (event.appCommandMetadata) {
        const commandId = String(event.appCommandMetadata.appCommandId);
        switch (commandId) {
            case "1": command = "add"; break;
            case "2": command = "remove"; break;
            case "3": command = "members"; break;
            case "4": command = "leave"; break;
            case "5": command = "mygroups"; break;
            case "6": command = "request_manager"; break; 
        }
        text = event.message?.argumentText || "";
    } else if (eventType === "MESSAGE") {
        const messageText = event.message?.text || "";
        if (event.message.slashCommand) {
            command = event.message.slashCommand.commandName.substring(1);
            text = event.message.argumentText || "";
        } else {
            if (!arePromptsLoaded) {
                return res.json({ text: "⏳ The bot is still starting up and loading configuration. Please try again in a few seconds." });
            }

            const aiIntent = await getGroupIntentFromAI(messageText);
            
            if (aiIntent.operation === "HELP_MENU") {
                return res.json(getWelcomeMenuResponse());
            } 
            
            if (aiIntent.operation === "FAQ_QUERY" || aiIntent.operation === "NONE") {
                
                const faqResponse = await getFaqAnswerFromAI(messageText);

                if (faqResponse === "NOT_LOADED_YET") {
                    return res.json({ text: "⏳ The knowledge base is still loading. Please try again in a few seconds." });
                } 
                
                if (faqResponse !== "NO_ENCONTRADO") {
                    return res.json({ text: faqResponse });
                }

                console.log(`LOG-FALLBACK: Detected ${aiIntent.operation} and no FAQ found. Returning General Fallback.`);
                return res.json({ text: FALLBACK_GENERAL_MESSAGE });
            } 
            
            if (aiIntent.operation && aiIntent.operation !== "NONE" && aiIntent.operation !== "FAQ_QUERY") {
                isFromAI = true;
                
                command = aiIntent.operation.substring(0, aiIntent.operation.indexOf('_')).toLowerCase(); 
                if (command === 'add') command = 'add'; 
                else if (command === 'remove') command = 'remove';
                else if (command === 'list') command = 'members';
                else if (command === 'leave') command = 'leave';
                else if (command === 'my') command = 'mygroups';
                else if (command === 'request') command = 'request_manager'; 
                else if (command === 'change') command = 'change_role_manager'; 
                else if (aiIntent.operation === 'VER_TODOS_LOS_MIEMBROS') command = 'list_all_members';

                users = aiIntent.users || [];
                groupKey = aiIntent.group || null;
            } else {
                return res.status(200).send();
            }
        }
    }


    if (!command) {
        return res.status(200).send();
    }

    if (!isFromAI) {
        const emails = text.match(flexibleEmailRegex) || [];

        if (command === "add" || command === "remove" || command === "change_role_manager") { 
            if (emails.length > 0) {
                groupKey = emails.pop(); 
                users = emails; 
            }
        } else { 
            groupKey = emails[0]; 
        }
    }

    groupKey = completeEmail(groupKey);
    users = users.map(completeEmail).filter(Boolean);

    if (["leave", "mygroups"].includes(command) && users.length === 0) {
        users = [userEmail];
    }


    try {
        switch (command) {
            case "list_all_members": 
                if (userEmail !== NOTIFICATION_EMAIL_RECIPIENT) { 
                    return res.json({ text: `❌ Access denied. This command is only for ${NOTIFICATION_EMAIL_RECIPIENT}.` });
                }
                const fullMemberList = await listAllGroupMembers();
                return res.json({ text: fullMemberList });

            case "request_manager":
                if (!groupKey) {
                    return res.json({ text: `Please indicate the group you want to be a manager of. Example: \`request to be manager of group support@\`` });
                }

                let requestedGroupName;
                try {
                    requestedGroupName = await getGroupName(groupKey); 
                    const requesterName = await getUserDisplayName(userEmail);

                    const emailSent = await sendManagerRequestEmail(userEmail, requesterName, groupKey, requestedGroupName);

                    if (emailSent) {
                        return res.json({ text: `✅ Request sent. ${NOTIFICATION_EMAIL_RECIPIENT} has been notified that ${requesterName} wants to be Manager of group **${requestedGroupName}**.` });
                    } else {
                        return res.json({ text: `❌ There was an error sending the notification. Please contact support manually.` });
                    }
                } catch (groupErr) {
                    if (groupErr.message === "GROUP_NOT_FOUND") {
                        return res.json({ text: `❌ Group **${groupKey}** does not exist in the Directory. Please verify the address.` });
                    }
                    throw groupErr; 
                }

            case "change_role_manager": 
                if (!groupKey || users.length === 0) {
                    return res.json({ text: `To change the role to Manager, indicate the user and the group. Example:\n\`make user@ manager of group@\`` });
                }

                const IS_GLOBAL_ADMIN_ROLE = (userEmail === NOTIFICATION_EMAIL_RECIPIENT);
                let hasPermissionRole = IS_GLOBAL_ADMIN_ROLE || await checkManagerPermission(groupKey, userEmail);

                if (!hasPermissionRole) return res.json({ text: `❌ You do not have Manager/Owner permissions to change roles in group **${groupKey}**.` });

                const groupNameRole = await getGroupName(groupKey);

                const resultsRole = await Promise.all(users.map(async (userInput) => { 
                    const userEmailApi = await resolveUserEmailByDisplayName(userInput);
                    const userNameForResponse = await getUserDisplayName(userEmailApi);

                    try {
                        await admin.members.update({ 
                            groupKey: groupKey, 
                            memberKey: userEmailApi, 
                            requestBody: { role: "MANAGER" } 
                        });
                        return `👑 **${userNameForResponse}** is now **Manager** in **${groupNameRole}**`;
                    } catch (err) {
                        console.error(`DEBUG: Error making ${userInput} Manager:`, err);
                        let specificError = "Unknown error.";
                        if (err.code === 404) specificError = `User **${userNameForResponse}** is not a member of **${groupNameRole}** or the group does not exist.`;
                        else if (err.code === 400) specificError = `Incorrect request. Verify if the user is already Owner/Manager or if the email is correct.`;
                        return `❌ Could not make **${userNameForResponse}** Manager: ${specificError}`;
                    }
                }));
                return res.json({ text: resultsRole.join("\n") });

            case "add":
            case "remove":
                if (!groupKey || users.length === 0) {
                    return res.json({ text: `To ${command} users, indicate the emails and the group. Example:\n\`/${command} user1@${DOMAIN} group@${DOMAIN}\`` });
                }

                let hasPermission = false;
                const IS_GLOBAL_ADMIN = (userEmail === NOTIFICATION_EMAIL_RECIPIENT);
                
                if (IS_GLOBAL_ADMIN) {
                    hasPermission = true; 
                    console.log("LOG-ADMIN-ACCESS: Global access granted to add/remove members.");
                } else {
                    hasPermission = await checkManagerPermission(groupKey, userEmail); 
                }
                
                if (!hasPermission) return res.json({ text: `❌ You do not have MANAGER/OWNER permissions for this action in group **${groupKey}**.` });

                const groupName = await getGroupName(groupKey);

                const results = await Promise.all(users.map(async (userInput) => { 
                    
                    console.log(`LOG-PROCESS: User/AI input for member: '${userInput}'`);
                    const userEmailApi = await resolveUserEmailByDisplayName(userInput);
                    console.log(`LOG-PROCESS: Final API Email: '${userEmailApi}' (Before: '${userInput}')`);
                    const userNameForResponse = await getUserDisplayName(userEmailApi);

                    try {
                        if (command === "add") {
                            await admin.members.insert({ groupKey: groupKey, requestBody: { email: userEmailApi, role: "MEMBER" } });
                            return `✅ **${userNameForResponse}** added to **${groupName}**`;
                        } else {
                            await admin.members.delete({ groupKey: groupKey, memberKey: userEmailApi });
                            return `✅ **${userNameForResponse}** removed from **${groupName}**`;
                        }
                    } catch (err) {
                        console.error(`DEBUG: Specific error while ${command}ing ${userInput}:`, err);
                        let specificError = "Unknown error.";
                        if (err.code === 404) specificError = `User **${userEmailApi}** or group **${groupKey}** does not exist.`;
                        else if (err.code === 409 && command === "add") specificError = `User **${userEmailApi}** is already a member.`;
                        else if (err.code === 400) specificError = `Incorrect request. Verify the emails.`;
                        return `❌ Could not ${command} **${userNameForResponse}**: ${specificError}`;
                    }
                }));
                return res.json({ text: results.join("\n") });

            case "members":
                if (!groupKey) {
                    return res.json({ text: `Indicate the group to see its members. Example:\n\`/members group@${DOMAIN}\`` });
                }

                if (!userEmail) {
                     return res.json({ text: `❌ Authentication error: Could not identify your email to verify permissions.` });
                }

                let canList = false;
                const IS_GLOBAL_ADMIN_LIST = (userEmail === NOTIFICATION_EMAIL_RECIPIENT); 
                
                if (IS_GLOBAL_ADMIN_LIST) {
                    canList = true; 
                    console.log("LOG-ADMIN-ACCESS: Global access granted to list members.");
                } else {
                    canList = await checkManagerPermission(groupKey, userEmail); 
                }
                
                if (!canList) return res.json({ text: `❌ You do not have MANAGER/OWNER permissions to query members of group **${groupKey}**.` });

                const membersList = await admin.members.list({ groupKey: groupKey });
                const currentGroupName = await getGroupName(groupKey);

                if (!membersList.data.members?.length) return res.json({ text: `⚠️ Group **${currentGroupName}** has no members.` });
                
                const memberDetailsPromises = membersList.data.members.map(async (m) => {
                    const name = await getUserDisplayName(m.email);
                    return `• ${name} (${m.role})`;
                });

                const members = (await Promise.all(memberDetailsPromises)).join("\n");
                return res.json({ text: `👥 Members of **${currentGroupName}**:\n${members}` });

            case "leave":
                if (!groupKey) {
                    return res.json({ text: `Indicate the group you want to leave. Example:\n\`/leave group@${DOMAIN}\`` });
                }
                const abandonedGroupName = await getGroupName(groupKey);
                await admin.members.delete({ groupKey: groupKey, memberKey: userEmail });
                return res.json({ text: `👋 You have left group **${abandonedGroupName}**` });

            case "mygroups":
                const response = await admin.groups.list({ userKey: userEmail });
                if (!response.data.groups?.length) return res.json({ text: "⚠️ You do not belong to any group." });
                
                const groupsWithRolesPromises = response.data.groups.map(async (g) => {
                    const groupName = await getGroupName(g.email);
                    let role = "Member"; 

                    try {
                        const memberDetails = await admin.members.get({ groupKey: g.email, memberKey: userEmail });
                        
                        switch (memberDetails.data.role) {
                            case "OWNER":
                                role = "Owner";
                                break;
                            case "MANAGER":
                                role = "Manager";
                                break;
                            default:
                                role = "Member";
                                break;
                        }
                    } catch (err) {
                        console.error(`Error obtaining user role in group ${g.email}:`, err);
                        role = "Member (Unverified)";
                    }
                    
                    return `• ${groupName} [**${role}**]`;
                });

                const groupsWithRoles = (await Promise.all(groupsWithRolesPromises)).join("\n");
                return res.json({ text: `👥 Groups you belong to:\n${groupsWithRoles}` });

            default:
                return res.status(200).send();
        }
    } catch (err) {
        console.error(`DEBUG: General error processing command '${command}':`, err);
        let userMessage = "❌ An error occurred while processing the request.";
        
        if (err.message === "GROUP_NOT_FOUND") userMessage = "❌ The specified group does not exist.";
        else if (err.message === "USER_KEY_MISSING_IN_PERMISSION_CHECK") userMessage = "❌ Internal error: Could not identify your user email to verify permissions.";
        else if (err.code === 403) userMessage = "❌ You do not have the appropriate permissions for this action.";
        else if (err.code === 404) userMessage = "❌ Group or user does not exist.";
        else if (err.code === 400) userMessage = "❌ Incorrect request. Verify the email format.";
        
        return res.json({ text: userMessage });
    }
});

// Initialize configuration and then start the server
Promise.all([
    getAdminSdkCredentials().then(initializeAdminSdk),
    loadConfigFromFirestore()
]).then(() => {
    app.listen(PORT, () => console.log(`🚀 Bot listening on port ${PORT} (v${BOT_VERSION})`));
}).catch(error => {
    console.error("--- FATAL ERROR DURING INITIALIZATION ---", error);
    process.exit(1);
});
