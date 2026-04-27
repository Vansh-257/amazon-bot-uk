const Imap = require("imap-simple");
// const { createLogger } = require("../utils/logger");
// const log = createLogger("GMAIL-OTP");

const GMAIL_IMAP_HOST = "imap.gmail.com";
const GMAIL_IMAP_PORT = 993;
const GMAIL_IMAP_AUTH_TIMEOUT_MS = 5000;
const OTP_SENDER = "no_reply@jobsatamazon.co.uk";
const OTP_PATTERN = /\b\d{6}\b/;

async function getOtpFromGmail(email, passkey) {
  const config = {
    imap: {
      user: email,
      password: passkey,
      host: GMAIL_IMAP_HOST,
      port: GMAIL_IMAP_PORT,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: GMAIL_IMAP_AUTH_TIMEOUT_MS
    }
  };

  let connection;
  try {
    console.log("Connecting to Gmail IMAP", { email });
    connection = await Imap.connect(config);
    console.log("Connected to Gmail IMAP", { email });

    await connection.openBox("INBOX");

    const searchCriteria = [["FROM", OTP_SENDER]];
    const fetchOptions = {
      bodies: ["HEADER", "TEXT"],
      markSeen: false
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log("Emails found", { email, count: messages.length });

    if (messages.length === 0) {
      console.log("No OTP emails found", { email });
      return null;
    }

    const latestMessage = messages[messages.length - 1];
    const emailBody = latestMessage.parts.find(
      (part) => part.which === "TEXT"
    )?.body;

    if (!emailBody) {
      console.log("Email body not found", { email });
      return null;
    }

    const bodyText =
      typeof emailBody === "string"
        ? emailBody
        : JSON.stringify(emailBody || {});
    const otpMatch = bodyText.match(OTP_PATTERN);

    if (otpMatch) {
      console.log("OTP found", { email });
      return otpMatch[0];
    }

    console.log("OTP not found in email body", { email });
    return null;
  } catch (error) {
    console.log("Error reading OTP from Gmail", { email, error: error.message });
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

module.exports = { getOtpFromGmail };

// if (require.main === module) {
//   const email = "prarthitapatel2809@gmail.com";
//   const passkey = "crgd kmbf hmrn muxm";

//   if (!email || !passkey) {
//     console.log("Missing credentials. Provide GMAIL_USER and GMAIL_APP_PASSWORD env vars or pass them as args.");
//     process.exit(1);
//   }

//   getOtpFromGmail(email, passkey)
//     .then((otp) => {
//       console.log("Result", { otp });
//       process.exit(0);
//     })
//     .catch(() => {
//       process.exit(1);
//     });
// }
