# Smart-Student-life-Manager
⚡ Smart Student Life Manager — Attendance, Syllabus Scheduler, AI MCQ Tests, Pomodoro, GPA Predictor | Pure HTML/CSS/JS | No frameworks | localStorage   [  html css javascript student-dashboard attendance-tracker syllabus-manager pomodoro-timer gpa-calculator ai-quiz claude-api single-file-app offline-app glassmorphism  ]              

📸 Preview
LoginDashboardStudy TimerGlassmorphism auth screenToday's schedule + statsCount-up timer → break → AI test

✨ Features
👤 Auth

Sign Up with Name, Username, Email, Password
Login with Username or Email
Multi-user support via localStorage
One-time Staff Setup modal on first login

📅 Attendance

Mark Present / Absent daily (locked after first mark)
Absent reason dropdown (Sick, Family Emergency, Transport Issue...)
WhatsApp deeplink — auto message to staff on absence
Attendance progress bar with 75% threshold warning
Full date-wise history table

📚 Syllabus Manager

Add multiple subjects with Units & Topics
Set Start Date → End Date — auto schedule generation
Smart spacing algorithm distributes topics evenly
Per-unit topic study → Unit Test → Grand Final Test
Schedule view with status badges (Pending / Done / Rescheduled)

⏱️ Study Session Flow
Start Study (count-up timer) → Done → 5 min Break → AI generates MCQs → Test → Score

Study topics → 10 AI questions
Unit Test → 100 AI questions (all unit topics)
Grand Test → 100 AI questions (all units combined)

🔄 Postpone System

Postpone up to 2 times per month
Rescheduled items become Catch-up tasks
Catch-up unlocks 10 minutes after completing regular tests
Live countdown timer on Dashboard

🍅 Pomodoro Timer

25-minute focus sessions with SVG circular ring
Session count & total focus minutes tracking
Completion → direct link to AI Quiz

🧠 AI Test Zone (Standalone)

On-demand 10 MCQ quiz powered by Claude AI
Based on your active syllabus topic
Answer review with correct/wrong breakdown
10-minute break timer after quiz

🎓 GPA Predictor

Add semesters with courses, grades (O / A+ / A / B+ / B / C / F), credits
Live GPA preview while adding courses
CGPA calculator — Distinction / First Class / Second Class
Delete individual semesters

🔔 Notifications

Morning ☀️ & Evening 🌙 reminder times
Toggle on/off
Browser Notification API integration

📊 Results & Report

Per-subject breakdown
Unit-wise score chips (color coded by performance)
Study time tracking
Grand Test card
Average score display

⚙️ Settings

Update staff name & WhatsApp number
Attendance summary
Monthly postpone usage display


🛠️ Tech Stack
LayerTechUIPure HTML5 + CSS3 (Glassmorphism)LogicVanilla JavaScript (ES2020)StoragelocalStorage (no server needed)AIClaude API (claude-sonnet-4-20250514)FontsGoogle Fonts — Syne + OutfitNotificationsBrowser Notification APIWhatsAppwa.me/ deeplink

📁 Data Structure
All data stored in localStorage per user:
json{
  "staff": { "name": "...", "number": "91XXXXXXXXXX" },
  "attendance": { "2025-03-11": { "status": "present", "reason": "" } },
  "syllabuses": [{
    "id": "abc123",
    "subject": "Data Structures",
    "units": [{ "name": "Unit 1", "topics": ["Arrays", "Linked Lists"] }],
    "schedule": [{
      "type": "study | unit_test | grand_test",
      "status": "pending | completed | postponed",
      "score": 85,
      "isCatchup": false
    }]
  }],
  "studyLog": [],
  "postpones": { "2025-03": 1 },
  "pomodoroSessions": 4,
  "gpa": { "semesters": [] },
  "notifications": { "morning": "08:00", "evening": "20:00", "enabled": true }
}

⚡ Getting Started

Download EduPulse-Final.html
Open in Chrome / Firefox / Edge
Sign Up → Login → Setup Staff → Start Learning!


Note: AI question generation requires an Anthropic API key configured in the fetch headers. Without it, fallback mock questions are used automatically.


🎨 Design

Theme: Deep space gradient (#030712 → #0a1628 → #0d0a2e)
Style: Glassmorphism cards with backdrop blur
Colors: Cyan #06b6d4 · Purple #a78bfa · Amber #f59e0b · Green #10b981 · Red #f87171
Animations: Ambient floating orbs, fadeIn transitions, SVG ring animation
Responsive: Collapsible sidebar + mobile hamburger menu


📄 License
MIT License — free to use, modify and distribute.
