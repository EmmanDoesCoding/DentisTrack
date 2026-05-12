🦷 DentisTrack

Smart Dental Clinic Queue Management System
A browser-based queuing and appointment platform built for dental clinics — no backend required.


What is DentisTrack?
DentisTrack is a lightweight, fully client-side web application that digitizes the patient queuing and appointment flow of a dental clinic. It replaces paper sign-in sheets and verbal queue-calling with a structured, real-time system accessible from any device — desktop, tablet, or mobile phone.
All data is stored using the browser's built-in localStorage, meaning the system works completely offline and requires no server, no database, and no internet connection after the initial page load. It can be deployed to any static hosting provider (such as Vercel) in under two minutes.

Features
For Patients

Patient Portal — Register as a new patient or sign back in anytime using your name and contact number
Smart Appointment Booking — Select one or more services; the system automatically calculates the total duration and only shows time slots that are actually available based on existing bookings
No double-booking — Two patients cannot be scheduled at the same date and time
Live Queue Position — After booking, patients see their position in the queue in real time
Visit History — Patients can sign back in to view all past completed appointments, services rendered, and amounts paid
Printable Receipts — Every appointment generates a receipt that can be printed or saved
"I closed the tab" recovery — Patients can sign back in at any time to find their active appointment and queue status

For Clinic Staff (Admin)

Queue Management — View all waiting patients sorted by appointment time; earliest appointment goes first regardless of when they registered
Mark Paid → Mark Completed — A two-step flow ensures patients cannot be marked as completed without payment first
Auto-skip logic — Patients who do not check in within 10 minutes of being called are automatically moved to the end of the queue; a 5-minute follow-up alert fires first
History Log — Daily records of every patient served, collapsible by date, with per-day revenue totals and individual receipt access
Revenue Dashboard — Total revenue, completed patient count, average bill, and a breakdown of earnings by service
Dentist Availability Panel — Set the dentist's current status (Available / With Patient / Unavailable); patients see this live on the booking screen
Queue Display Board — Opens in a separate window designed for a TV or monitor in the waiting area; shows who is currently being served, the next 5 patients, and dentist status; auto-refreshes every 5 seconds


Services & Pricing
#ServicePriceDuration1Dental Cleaning₱1,00030 min – 1 hour2Pasta (Tooth Filling)₱1,0001 hour3Temporary Pasta₱80045 minutes4Tooth Extraction₱1,0001 hour5Denture Fitting₱10,0001 hour6Braces₱50,000+2 hours7Braces Adjustment₱1,0001 hour8Wisdom Tooth Extraction₱8,000 – ₱15,0001.5 – 2 hours

Prices marked with + vary by case complexity. The system uses the maximum duration for scheduling to prevent conflicts.


Demo Credentials
Admin / Staff Login
FieldValueUsernameadminPassworddentis2024
Demo Patient Accounts (pre-seeded)
NameContactMaria Santos09171234567Jose Reyes09281234567Ana Cruz09991234567Pedro Bautista09451234567Lilia Gomez09651234567Rosa Dela Cruz09121234567

File Structure
dentistrack/
├── index.html      # All pages and HTML structure
├── style.css       # Full styling — mobile-first, responsive
└── app.js          # All application logic and localStorage management
No build tools, no frameworks, no dependencies. Open index.html in any browser and it works.

How to Run Locally

Download or clone the three files into a folder
Open index.html in any modern browser (Chrome, Safari, Firefox, Edge)
That's it — no terminal, no npm install, no server needed


How to Deploy on Vercel

Go to vercel.com and create a free account
Click Add New → Project
Drag and drop the folder containing the three files, or connect a GitHub repository
Vercel detects it as a static site automatically — click Deploy
Your app is live at a public URL (e.g. dentistrack.vercel.app) within 60 seconds

No configuration files needed. Vercel handles everything automatically for plain HTML projects.

How localStorage Works in This Context
localStorage is a storage mechanism built into every modern browser. It saves data as key-value pairs on the user's device and persists across page refreshes, browser restarts, and tab closures — until the user manually clears their browser data.
In DentisTrack, the following data is saved automatically after every action:
KeyContentsdt_queueAll active and waiting appointmentsdt_completedAll completed appointments (full history)dt_patientsAll registered patient accountsdt_next_idAuto-incrementing ID counterdt_dentist_statusCurrent dentist availability status
Works on mobile? Yes. localStorage is supported on all major mobile browsers including Chrome for Android and Safari for iOS. As long as a patient uses the same browser on the same device, their account and appointment data will be available when they return.

Tech Stack
LayerTechnologyStructureHTML5StylingCSS3 (custom properties, CSS Grid, Flexbox)LogicVanilla JavaScript (ES6+)PersistenceBrowser localStorage APIFontsGoogle Fonts — DM Serif Display, DM SansDeploymentVercel (static hosting)
No external JavaScript libraries. No frameworks. No backend.

Scheduling Logic
When a patient selects services and a date, the system:

Calculates the total maximum duration of all selected services
Scans every 30-minute slot from 8:00 AM to 6:00 PM on that date
Checks each slot against all existing appointments for time conflicts
Only presents slots where the full duration fits without overlapping any existing booking

This means if a patient books Braces (2 hours) at 9:00 AM, the next available slot on that day will be 11:00 AM at the earliest — the system handles this automatically.

Queue Priority Logic
Patients are ordered in the queue by appointment time, not by registration time. This means:

A patient who registered at 2:00 PM for a 9:00 AM slot will appear ahead of a patient who registered at 8:00 AM for a 3:00 PM slot
If a patient is skipped (no-show after 10 minutes), they are moved to the end of the queue but remain in the system and can be restored by staff
