# Multi-Drive Uploader Hub 🚀

A premium, unified web dashboard to manage and upload files across multiple cloud storage providers from a single interface. Built with a focus on ease of use, security, and a sleek modern aesthetic.

---

## 🌟 Key Features

- **Multi-Provider Support**: Seamlessly upload to Google Drive, Microsoft OneDrive, Amazon S3, Box.com, and Zoho WorkDrive.
- **Unified Interface**: One dashboard for all your cloud storage needs—no more switching tabs between different provider consoles.
- **Smart Proxy System**: View and download files directly from the dashboard, even for providers with complex authentication (like Zoho).
- **Automated Token Management**: Handles OAuth 2.0 token refreshes and rotations automatically for Box and Zoho.
- **Premium UI/UX**: A dark-mode, glassmorphism-inspired design with real-time feedback and micro-animations.
- **Quick Share**: Built-in "Copy URL" feature to instantly grab a direct view/download link for any uploaded file.

---

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Frontend**: Vanilla HTML5, CSS3 (Custom Design System), JavaScript (ES6+)
- **Storage Core**: [multi-drive-uploader](https://www.npmjs.com/package/multi-drive-uploader) (v^1.0.1) — A robust Node.js library that abstracts multiple cloud storage APIs (Google, OneDrive, S3, Box, Zoho) into a single, unified interface.
- **Utilities**: Axios (API requests), Multer (File handling), Dotenv (Secret management)

---

## 📂 Project Structure

```text
├── public/                 # Frontend assets (HTML, CSS, JS)
│   ├── index.html          # Main dashboard UI
│   ├── style.css           # Custom glassmorphism design system
│   └── script.js           # Frontend logic & API interaction
├── scripts/                # Utility scripts for token generation
│   ├── Zoho Token Generator.py  # Manual helper for Zoho OAuth
│   ├── Box Token Generator.py   # Manual helper for Box OAuth
│   └── Token Generator.py       # Helper for other providers
├── server.js               # Main Express server & Proxy logic
├── .env                    # Environment secrets (Credentials & Tokens)
└── package.json            # Node.js dependencies
```

---

## 🚀 Getting Started

### 1. Installation

Clone the repository and install dependencies:

```bash
npm install
```

### 2. Configuration (.env)

Create a `.env` file in the root directory and fill in your provider credentials. Use the provided generator scripts to obtain refresh tokens where necessary.

**Zoho Example:**
```env
ZOHO_CLIENT_ID=your_id
ZOHO_CLIENT_SECRET=your_secret
ZOHO_REFRESH_TOKEN=your_permanent_refresh_token
ZOHO_FOLDER_ID=your_workdrive_folder_id
ZOHO_DATA_CENTER=IN # Current options: US, EU, IN, AU, JP, CN
```

### 3. Obtaining Tokens

For providers like **Zoho** or **Box**, standard login tokens work for only a few minutes. Use the specialized scripts in the `/scripts` folder to generate **permanent refresh tokens**:

- **Zoho**: Run `python "scripts/Zoho Token Generator.py"` and follow the instructions.
- **Box**: Run `python "scripts/Box Token Generator.py"`.

---

## 💻 Usage

### Starting the Server
```bash
npm start
```
The server will start at `http://localhost:8080`.

### Uploading a File
1. Open the dashboard in your browser.
2. Select your preferred Cloud Provider.
3. Drag & drop a file into the upload zone.
4. Click **Upload Now**.

### Viewing/Sharing
Once uploaded, you can:
- **View File**: Opens the file in a new tab (if supported by your browser).
- **Copy URL**: Grabs a direct link that can be shared or pasted elsewhere.
- **Download**: Directly pulls the file from the cloud through our secure proxy.

---

## 🛡️ Security & Privacy

- **On-Premise**: All credentials stay on your server.
- **Secure Proxy**: Authentication headers are injected server-side; tokens are never exposed to the client-side browser or shared links.
- **Automatic Rotation**: Refresh tokens are automatically updated in your `.env` file when the provider issues a new one.

---

## 📝 License

This project is built using the `multi-drive-uploader` library. Please refer to its documentation for specific provider limitations.
