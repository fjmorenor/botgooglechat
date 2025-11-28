import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import { Firestore } from "@google-cloud/firestore";
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Base64 } from 'js-base64';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const DELEGATED_ADMIN_EMAIL = process.env.DELEGATED_ADMIN_EMAIL;
const DOMINIO = "yourdomain.com";
const NOTIFICATION_EMAIL_RECIPIENT = "admin_support@yourdomain.com";
const BOT_VERSION = "2.8.36-Welcome-Fix";
const FALLBACK_GENERAL_MESSAGE = "❌ I can only help you manage mail groups. Please indicate a valid action or type **\"Menu\"** to see the available options";

const firestore = new Firestore({ databaseId: 'databasechat' });
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
let groupManagementPrompt = "", knowledgeBaseText = "", faqDataArray = [], arePromptsLoaded = false;
const secretManagerClient = new SecretManagerServiceClient();
const SECRET_PATH = process.env.ADMIN_SDK_SECRET_PATH;
let admin, auth, gmail;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getAdminSdkCredentials() {
    try {
        if (!SECRET_PATH) throw new Error("ADMIN_SDK_SECRET_PATH not configured.");
        const [version] = await secretManagerClient.accessSecretVersion({ name: SECRET_PATH });
        return JSON.parse(version.payload.data.toString('utf8'));
    } catch (error) {
        console.error("--- FATAL ERROR GETTING CREDENTIALS ---", error.message);
        process.exit(1);
    }
}

function initializeAdminSdk(credentials) {
    auth = google.auth.fromJSON(credentials);
    auth.subject = DELEGATED_ADMIN_EMAIL;
    auth.scopes = [
        "https://www.googleapis.com/auth/admin.directory.group.member", "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
        "https://www.googleapis.com/auth/admin.directory.group.readonly", "https://www.googleapis.com/auth/admin.directory.group",
        "https://www.googleapis.com/auth/admin.directory.user.readonly", "https://www.googleapis.com/auth/gmail.send"
    ];
    admin = google.admin({ version: "directory_v1", auth });
    gmail = google.gmail({ version: 'v1', auth });
}

function getWelcomeMenuResponse() {
    return {
        text: `👋 Hello! I am **Bot G-Admin**, your Google Workspace IT Agent for **[Company Name]**.\n\nMy mission is to execute administrative tasks for **Mail Groups** quickly and easily directly from this chat with limited functions.\n\n### ⚙️⚙️ Quick Management Commands\n\n| Action | Description | Quick Example |\n| :--- | :--- | :--- |\n| **Añadir (Add)** | Adds users to a group. | \`/añadir user@ to group.test@\` |\n| **Eliminar (Remove)** | Removes users from a group. | \`/eliminar user@ from group.test@\` |\n| **Manager** | Converts a Member to a Manager. | \`make user@ manager of group@\` |\n| **Miembros (Members)** | Shows who belongs to the group. | \`/miembros support@\` |\n| **Abandonar (Leave)** | Removes yourself from a group. | \`/abandonar office.city@\` |\n| **Misgrupos (MyGroups)** | Shows which groups you belong to. | \`/misgrupos\` |\n| **Solicitar Manager (Request Manager)** | Requests management permissions for a group. | \`/solicitar manager de group.test@\` |\n\n> 💡 **Tip:** You can use usernames (e.g., "First Last") or partial emails (e.g., "support@") without the full domain.\n\n---\n\nFor any questions or inquiries, contact ${NOTIFICATION_EMAIL_RECIPIENT}`
    };
}

function completeEmail(email) {
    if (typeof email !== 'string') return email;
    if (email.endsWith('@') || (email.includes('@') && !email.includes('.'))) return email + DOMINIO;
    return email;
}

async function getUserDisplayName(userEmail) {
    try {
        return (await admin.users.get({ userKey: userEmail })).data.name?.fullName || userEmail;
    } catch (err) {
        return userEmail;
    }
}

async function getGroupName(groupEmail) {
    try {
        return (await admin.groups.get({ groupKey: groupEmail })).data.name || groupEmail;
    } catch (err) {
        if (err.code === 404) throw new Error("GROUP_NOT_FOUND");
        throw err;
    }
}

async function resolveUserEmailByDisplayName(displayNameOrKey) {
    if (typeof displayNameOrKey !== 'string') return displayNameOrKey;
    const input = displayNameOrKey.trim();
    const inputLower = input.toLowerCase();

    if (input.includes('@')) {
        const fullEmail = completeEmail(input);
        try {
            return (await admin.users.get({ userKey: fullEmail })).data.primaryEmail;
        } catch (err) {
            return fullEmail;
        }
    }

    try {
        return (await admin.users.get({ userKey: inputLower })).data.primaryEmail;
    } catch (err) {
        try {
            const queryName = input.trim().replace(/\s+/g, '+');
            let response = await admin.users.list({ domain: DOMINIO, query: `name:'${queryName}*'`, maxResults: 1 });
            if (response.data.users?.length) return response.data.users[0].primaryEmail;
            
            const firstWord = input.trim().split(' ')[0];
            if (firstWord !== input.trim()) {
                response = await admin.users.list({ domain: DOMINIO, query: `name:'${firstWord}*'`, maxResults: 1 });
                if (response.data.users?.length) return response.data.users[0].primaryEmail;
            }
        } catch (innerErr) { /* fallback to original input */ }
        return input;
    }
}

async function loadConfigFromFirestore() {
    let attempts = 0;
    while (attempts < 3 && !arePromptsLoaded) {
        attempts++;
        try {
            const botCollectionSnap = await firestore.collection('Collection Bot').limit(1).get();
            if (!botCollectionSnap.empty && botCollectionSnap.docs[0].data()?.['chat-omega']) {
                const basePrompt = botCollectionSnap.docs[0].data()['chat-omega'];
                groupManagementPrompt = basePrompt.replace('--- User: "{{user_input}}" JSON Response:', '\n--- User: "{{user_input}}" JSON Response:');
            } else {
                groupManagementPrompt = `... (Prompt fallback)`;
            }

            const faqSnapshot = await firestore.collection('faq').limit(1).get();
            if (!faqSnapshot.empty) {
                const docData = faqSnapshot.docs[0].data();
                const rawFaqString = docData.faq_documentation || docData[Object.keys(docData).find(k => k.includes('faq'))];
                if (typeof rawFaqString === 'string' && rawFaqString.length > 10) {
                    const faqArray = JSON.parse(rawFaqString);
                    if (Array.isArray(faqArray) && faqArray.length > 0) {
                        faqDataArray = faqArray;
                        knowledgeBaseText = faqArray.map(item => `Category: ${item.categoria}. Question: "${(item.preguntas || []).join(', ')}". Standard Answer: "${item.respuesta_estandar || item.respuestaestandar || 'Not available'}". Detailed Steps: * ${(item.pasos_detallados || []).join(' * ')}`).join('\n\n---\n\n');
                    }
                }
            }
            arePromptsLoaded = true;
        } catch (error) {
            console.error(`Error loading from Firestore (Attempt ${attempts}):`, error.message);
            if (attempts >= 3) {
                groupManagementPrompt = `... (Critical fallback)`;
                knowledgeBaseText = "";
                arePromptsLoaded = true;
            } else await delay(5000);
        }
    }
}

function getDeterministicFaqAnswer(userInput) {
    if (faqDataArray.length === 0) return null;
    const queryLower = userInput.toLowerCase().trim();
    const significantQueryWords = queryLower.split(/\s+/).filter(word => word.length >= 4);

    for (const item of faqDataArray) {
        const searchPoolTexts = [
            (item.categoria || '').toLowerCase(), (item.respuesta_estandar || item.respuestaestandar || '').toLowerCase(),
            ...(item.preguntas || []).map(q => q.toLowerCase()), ...(item.keywords || []).map(k => k.toLowerCase())
        ];
        
        const matchFullQuery = searchPoolTexts.some(faq_text => faq_text.includes(queryLower) || queryLower.includes(faq_text));
        const matchSignificantWords = significantQueryWords.some(word => searchPoolTexts.some(faq_text => faq_text.includes(word)));
        
        if (matchFullQuery || matchSignificantWords) {
            const steps = (item.pasos_detallados || []).join('\n* ');
            let response = `${item.respuesta_estandar || item.respuestaestandar || 'Not available'}.\n\n`;
            if (steps.trim()) response += `Detailed Steps:\n* ${steps}`;
            return `${response}\n\nIf the problem persists or you need further assistance, please contact ${NOTIFICATION_EMAIL_RECIPIENT}`;
        }
    }
    return null;
}

async function getFaqAnswerFromAI(userInput) {
    const deterministicAnswer = getDeterministicFaqAnswer(userInput);
    if (deterministicAnswer) return deterministicAnswer;

    if (!arePromptsLoaded || !knowledgeBaseText || knowledgeBaseText.length > 5000) return "NO_ENCONTRADO";

    const faqPrompt = `You are an expert technical support assistant. Your only task is to answer the user's question using the provided KNOWLEDGE BASE exclusively. If the answer is there, respond clearly and concisely, formatting titles with bold (*Detailed Steps:*, *Alternative Solutions:*). If it is not there, respond *exactly* with "NO_ENCONTRADO". At the end of EVERY response (except if it is NO_ENCONTRADO), always add the phrase: "If the problem persists or you need further assistance, please contact ${NOTIFICATION_EMAIL_RECIPIENT}."\n\n--- KNOWLEDGE BASE ---\n${knowledgeBaseText}\n---\nUser: "${userInput}"\nAnswer:`;
    
    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ contents: [{ parts: [{ text: faqPrompt }] }] })
        });
        if (!response.ok) return "NO_ENCONTRADO";
        const result = await response.json();
        let answer = result.candidates?.[0]?.content?.parts?.[0]?.text || "NO_ENCONTRADO";
        
        if (answer !== "NO_ENCONTRADO" && !answer.includes(NOTIFICATION_EMAIL_RECIPIENT)) {
            answer += `\n\nIf the problem persists or you need further assistance, please contact ${NOTIFICATION_EMAIL_RECIPIENT}.`;
        }
        return answer;
    } catch (error) {
        return "NO_ENCONTRADO";
    }
}

async function getGroupIntentFromAI(userInput) {
    if (!arePromptsLoaded || !groupManagementPrompt) return { operation: "NONE", reply_text: "AI configuration not ready." };
    const intentPrompt = groupManagementPrompt.replace("{{user_input}}", userInput);

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ contents: [{ parts: [{ text: intentPrompt }] }], generationConfig: { responseMimeType: "application/json" } })
        });
        if (!response.ok) throw new Error(`Gemini API Error (Intent): ${response.statusText}`);
        
        const jsonString = (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonString) return { operation: "NONE" };
        
        const cleanJsonString = jsonString.replace(/^```json\s*|s*```$/g, '').trim();
        return JSON.parse(cleanJsonString);

    } catch (error) {
        return { operation: "NONE", reply_text: "There was a problem contacting the AI to interpret the intent." };
    }
}

async function checkManagerPermission(groupKey, userKey) {
    if (!userKey) throw new Error("USER_KEY_MISSING_IN_PERMISSION_CHECK");
    try {
        return ["MANAGER", "OWNER"].includes((await admin.members.get({ groupKey: groupKey, memberKey: userKey })).data.role);
    } catch (err) {
        if (err.code === 404) {
            try { await admin.groups.get({ groupKey: groupKey }); return false; } 
            catch (groupErr) { if (groupErr.code === 404) throw new Error("GROUP_NOT_FOUND"); throw groupErr; }
        }
        throw err;
    }
}

async function sendManagerRequestEmail(requesterEmail, requesterName, groupEmail, groupName) {
    const TO = NOTIFICATION_EMAIL_RECIPIENT;
    const SUBJECT_CLEAN = `📞 Manager Role Request 📞`;
    const encodedSubject = `=?UTF-8?B?${Base64.encode(SUBJECT_CLEAN)}?=`;
    const BODY = `The user ${requesterName} has requested to be a MANAGER of the group ${groupName}.\n\nRequest Details:\n- Requester: ${requesterName} (${requesterEmail})\n- Group: ${groupName} (${groupEmail})\n\nPlease access the administration console to review and approve the request.`;
    
    const raw = [`To: ${TO}`, `Subject: ${encodedSubject}`, `From: ${DELEGATED_ADMIN_EMAIL}`, 'Content-Type: text/plain; charset="UTF-8"', 'MIME-Version: 1.0', '', BODY].join('\n');

    try {
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Base64.encodeURI(raw) } });
        return true;
    } catch (error) {
        console.error("EMAIL: Error sending Manager request email:", error.message);
        return false;
    }
}

async function listAllGroupMembers() {
    return "Global listing logic not implemented or only available for the super-admin.";
}

app.post("/", async (req, res) => {
    if (!admin) return res.json({ text: "The bot is still starting, please wait." });

    const { body: event, type: eventType } = req;
    if (eventType === "ADDED_TO_SPACE") return res.json(getWelcomeMenuResponse());
    
    const userEmail = event.user?.email || event.message?.sender?.email;
    if (!userEmail) return res.status(400).send("No user email found in the event.");

    let comando, usuarios = [], grupo = null, text = "", isFromAI = false;
    const flexibleEmailRegex = /[\w._%+-]+@(?:[\w.-]+\.[a-zA-Z]{2,})?|[\w._%+-]+@/g;

    if (event.appCommandMetadata) {
        const commandId = String(event.appCommandMetadata.appCommandId);
        switch (commandId) {
            case "1": comando = "añadir"; break; case "2": comando = "eliminar"; break;
            case "3": comando = "miembros"; break; case "4": comando = "abandonar"; break;
            case "5": comando = "misgrupos"; break; case "6": comando = "solicitar_manager"; break;
        }
        text = event.message?.argumentText || "";
    } else if (eventType === "MESSAGE") {
        const messageText = event.message?.text || "";
        if (event.message.slashCommand) {
            comando = event.message.slashCommand.commandName.substring(1);
            text = event.message.argumentText || "";
        } else {
            if (!arePromptsLoaded) return res.json({ text: "⏳ The bot is still starting and loading configuration. Please try again in a few seconds." });
            
            const aiIntent = await getGroupIntentFromAI(messageText);
            
            if (aiIntent.operation === "HELP_MENU") return res.json(getWelcomeMenuResponse());

            if (aiIntent.operation === "FAQ_QUERY" || aiIntent.operation === "NONE") {
                const faqResponse = await getFaqAnswerFromAI(messageText);
                if (faqResponse === "NOT_LOADED_YET") return res.json({ text: "⏳ The knowledge base is still loading. Try again." });
                if (faqResponse !== "NO_ENCONTRADO") return res.json({ text: faqResponse });
                return res.json({ text: FALLBACK_GENERAL_MESSAGE });
            }
            
            if (aiIntent.operation) {
                isFromAI = true;
                comando = aiIntent.operation.split('_')[0].toLowerCase();
                if (comando === 'add') comando = 'añadir'; else if (comando === 'remove') comando = 'eliminar';
                else if (comando === 'list') comando = 'miembros'; else if (comando === 'leave') comando = 'abandonar';
                else if (comando === 'my') comando = 'misgrupos'; else if (comando === 'solicitar') comando = 'solicitar_manager';
                else if (comando === 'change') comando = 'cambiar_rol_manager'; else if (aiIntent.operation === 'VER_TODOS_LOS_MIEMBROS') comando = 'ver_todos_los_miembros';

                usuarios = aiIntent.users || [];
                grupo = aiIntent.group || null;
            } else return res.status(200).send();
        }
    }

    if (!comando) return res.status(200).send();

    if (!isFromAI) {
        const emails = text.match(flexibleEmailRegex) || [];
        if (["añadir", "eliminar", "cambiar_rol_manager"].includes(comando) && emails.length > 0) {
            grupo = emails.pop();
            usuarios = emails;
        } else if (emails.length > 0) {
            grupo = emails[0];
        }
    }

    grupo = completeEmail(grupo);
    usuarios = usuarios.map(completeEmail).filter(Boolean);
    if (["abandonar", "misgrupos"].includes(comando) && usuarios.length === 0) usuarios = [userEmail];

    try {
        if (comando === "ver_todos_los_miembros") {
            if (userEmail !== NOTIFICATION_EMAIL_RECIPIENT) return res.json({ text: `❌ Access denied. This command is only for ${NOTIFICATION_EMAIL_RECIPIENT}.` });
            return res.json({ text: await listAllGroupMembers() });
        }

        if (comando === "solicitar_manager") {
            if (!grupo) return res.json({ text: `Please indicate the group you want to be manager of. Example: \`solicitar ser manager del grupo support@\`` });
            try {
                const requestedGroupName = await getGroupName(grupo);
                const requesterName = await getUserDisplayName(userEmail);
                const emailSent = await sendManagerRequestEmail(userEmail, requesterName, grupo, requestedGroupName);
                return res.json({ text: emailSent ? `✅ Request sent. ${NOTIFICATION_EMAIL_RECIPIENT} has been notified that ${requesterName} wishes to be a Manager of the group **${requestedGroupName}**.` : `❌ There was an error sending the notification. Please contact support manually.` });
            } catch (groupErr) {
                return res.json({ text: groupErr.message === "GROUP_NOT_FOUND" ? `❌ The group **${grupo}** does not exist in the Directory. Please verify the address.` : "❌ An error occurred." });
            }
        }

        if (comando === "cambiar_rol_manager") {
            if (!grupo || usuarios.length === 0) return res.json({ text: `To change the role to Manager, indicate the user and the group. Example:\n\`make user@ manager of group@\`` });
            const hasPermissionRole = (userEmail === NOTIFICATION_EMAIL_RECIPIENT) || await checkManagerPermission(grupo, userEmail);
            if (!hasPermissionRole) return res.json({ text: `❌ You do not have Manager/Owner permissions to change roles in the group **${grupo}**.` });

            const groupNameRole = await getGroupName(grupo);
            const resultadosRole = await Promise.all(usuarios.map(async (userInput) => {
                const userEmailApi = await resolveUserEmailByDisplayName(userInput);
                const userNameForResponse = await getUserDisplayName(userEmailApi);
                try {
                    await admin.members.update({ groupKey: grupo, memberKey: userEmailApi, requestBody: { role: "MANAGER" } });
                    return `👑 **${userNameForResponse}** is now a **Manager** in **${groupNameRole}**`;
                } catch (err) {
                    let specificError = "Unknown error.";
                    if (err.code === 404) specificError = `The user **${userNameForResponse}** is not a member of **${groupNameRole}** or the group does not exist.`;
                    else if (err.code === 400) specificError = `Incorrect request. Verify if the user already is Owner/Manager or if the email is correct.`;
                    return `❌ Could not make **${userNameForResponse}** Manager: ${specificError}`;
                }
            }));
            return res.json({ text: resultadosRole.join("\n") });
        }

        if (["añadir", "eliminar"].includes(comando)) {
            if (!grupo || usuarios.length === 0) return res.json({ text: `To ${comando} users, indicate the emails and the group. Example:\n\`/${comando} user1@${DOMINIO} group@${DOMINIO}\`` });
            const hasPermission = (userEmail === NOTIFICATION_EMAIL_RECIPIENT) || await checkManagerPermission(grupo, userEmail);
            if (!hasPermission) return res.json({ text: `❌ You do not have MANAGER/OWNER permissions for this action in the group **${grupo}**.` });

            const groupName = await getGroupName(grupo);
            const resultados = await Promise.all(usuarios.map(async (userInput) => {
                const userEmailApi = await resolveUserEmailByDisplayName(userInput);
                const userNameForResponse = await getUserDisplayName(userEmailApi);
                try {
                    if (comando === "añadir") {
                        await admin.members.insert({ groupKey: grupo, requestBody: { email: userEmailApi, role: "MEMBER" } });
                        return `✅ **${userNameForResponse}** added to **${groupName}**`;
                    } else {
                        await admin.members.delete({ groupKey: grupo, memberKey: userEmailApi });
                        return `✅ **${userNameForResponse}** removed from **${groupName}**`;
                    }
                } catch (err) {
                    let specificError = "Unknown error.";
                    if (err.code === 404) specificError = `The user **${userEmailApi}** or the group **${grupo}** does not exist(s).`;
                    else if (err.code === 409 && comando === "añadir") specificError = `The user **${userEmailApi}** is already a member.`;
                    else if (err.code === 400) specificError = `Incorrect request. Verify the emails.`;
                    return `❌ Could not ${comando} **${userNameForResponse}**: ${specificError}`;
                }
            }));
            return res.json({ text: resultados.join("\n") });
        }

        if (comando === "miembros") {
            if (!grupo) return res.json({ text: `Indicate the group to see its members. Example:\n\`/miembros group@${DOMINIO}\`` });
            if (!userEmail) return res.json({ text: `❌ Authentication error: Could not identify your email to verify permissions.` });

            const canList = (userEmail === NOTIFICATION_EMAIL_RECIPIENT) || await checkManagerPermission(grupo, userEmail);
            if (!canList) return res.json({ text: `❌ You do not have MANAGER/OWNER permissions to query members of the group **${grupo}**.` });

            const { data: { members } } = await admin.members.list({ groupKey: grupo });
            const currentGroupName = await getGroupName(grupo);

            if (!members?.length) return res.json({ text: `⚠️ The group **${currentGroupName}** has no members.` });

            const miembros = (await Promise.all(members.map(async m => `• ${await getUserDisplayName(m.email)} (${m.role})`))).join("\n");
            return res.json({ text: `👥 Members of **${currentGroupName}**:\n${miembros}` });
        }

        if (comando === "abandonar") {
            if (!grupo) return res.json({ text: `Indicate the group you wish to leave. Example:\n\`/abandonar group@${DOMINIO}\`` });
            const abandonedGroupName = await getGroupName(grupo);
            await admin.members.delete({ groupKey: grupo, memberKey: userEmail });
            return res.json({ text: `👋 You have left the group **${abandonedGroupName}**` });
        }

        if (comando === "misgrupos") {
            const { data: { groups } } = await admin.groups.list({ userKey: userEmail });
            if (!groups?.length) return res.json({ text: "⚠️ You do not belong to any groups." });

            const groupsWithRoles = (await Promise.all(groups.map(async g => {
                const groupName = await getGroupName(g.email);
                let role = "Member";
                try {
                    const memberRole = (await admin.members.get({ groupKey: g.email, memberKey: userEmail })).data.role;
                    if (memberRole === "OWNER") role = "Owner";
                    else if (memberRole === "MANAGER") role = "Manager";
                } catch (err) { role = "Member (Unverified)"; }
                return `• ${groupName} [**${role}**]`;
            }))).join("\n");
            return res.json({ text: `👥 Groups you belong to:\n${groupsWithRoles}` });
        }
        
        return res.status(200).send();
    } catch (err) {
        let userMessage = "❌ An error occurred while processing the request.";
        if (err.message === "GROUP_NOT_FOUND") userMessage = "❌ The specified group does not exist.";
        else if (err.message === "USER_KEY_MISSING_IN_PERMISSION_CHECK") userMessage = "❌ Internal error: Could not identify your user email to verify permissions.";
        else if (err.code === 403) userMessage = "❌ You do not have the appropriate permissions for this action.";
        else if (err.code === 404) userMessage = "❌ Group or user does not exist.";
        else if (err.code === 400) userMessage = "❌ Incorrect request. Verify the email format.";
        return res.json({ text: userMessage });
    }
});

Promise.all([
    getAdminSdkCredentials().then(initializeAdminSdk),
    loadConfigFromFirestore()
]).then(() => {
    app.listen(PORT, () => console.log(`🚀 Bot listening on port ${PORT} (v${BOT_VERSION})`));
}).catch(error => {
    console.error("--- FATAL ERROR DURING INITIALIZATION ---", error.message);
    process.exit(1);
});