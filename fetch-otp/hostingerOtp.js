const imaps = require("imap-simple");

const HOSTINGER_IMAP_HOST = "imap.hostinger.com";
const HOSTINGER_IMAP_PORT = 993;
const HOSTINGER_IMAP_AUTH_TIMEOUT_MS = 3000;
const OTP_SENDER = "no_reply@jobsatamazon.co.uk";
const OTP_PATTERN = /\b\d{6}\b/;

function resolveMailboxCredentials(aliasEmail) {
  const localPart = String(aliasEmail || "").split("@")[0].toLowerCase();

  if (localPart.startsWith("kevin")) {
    return {
      mailBoxEmail: "slotica02@jgemaill.fun",
      password: "Slotica@02"
    };
  }

  return {
    mailBoxEmail: "slotica@jgemaill.fun",
    password: "Slotica@01"
  };
}

async function getOtpFromHostinger(aliasEmail) {
  const { mailBoxEmail, password } = resolveMailboxCredentials(aliasEmail);

  let connection;
  try {
    console.log("Connecting to Hostinger IMAP", { mailBoxEmail, aliasEmail });
    connection = await imaps.connect({
      imap: {
        user: mailBoxEmail,
        password,
        host: HOSTINGER_IMAP_HOST,
        port: HOSTINGER_IMAP_PORT,
        tls: true,
        authTimeout: HOSTINGER_IMAP_AUTH_TIMEOUT_MS
      }
    });
    console.log("Connected to Hostinger IMAP", { mailBoxEmail, aliasEmail });

    await connection.openBox("INBOX");

    const messages = await connection.search(
      [["TO", aliasEmail], ["FROM", OTP_SENDER]],
      {
        bodies: ["HEADER", "TEXT"],
        markSeen: false
      }
    );

    console.log("Emails found", { aliasEmail, count: messages.length });

    if (messages.length === 0) {
      console.warn("No OTP emails found", { aliasEmail });
      return null;
    }

    const latestMessage = messages[messages.length - 1];
    const emailBody = latestMessage.parts.find(
      (part) => part.which === "TEXT"
    )?.body;

    if (!emailBody) {
      console.warn("Email body not found", { aliasEmail });
      return null;
    }

    const bodyText =
      typeof emailBody === "string"
        ? emailBody
        : JSON.stringify(emailBody || {});
    const otpMatch = bodyText.match(OTP_PATTERN);

    if (otpMatch) {
      console.log("OTP found", { aliasEmail });
      return otpMatch[0];
    }

    console.warn("OTP not found in email body", { aliasEmail });
    return null;
  } catch (error) {
    console.error("Error reading OTP from Hostinger", {
      aliasEmail,
      error: error.message
    });
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (_error) {
        // Ignore close errors.
      }
    }
  }
}

module.exports = { getOtpFromHostinger, resolveMailboxCredentials };

// if (require.main === module) {
//   const aliasEmail = "dale001@jgemaill.fun";

//   if (!aliasEmail) {
//     log.error("Missing alias email. Provide ALIAS_EMAIL env var or pass it as an arg.");
//     process.exit(1);
//   }

//   getOtpFromHostinger(aliasEmail)
//     .then((otp) => {
//       console.log("Result", { otp });
//       process.exit(0);
//     })
//     .catch(() => {
//       console.error("Error occurred while fetching OTP"); 
//       process.exit(1);
//     });
// }
