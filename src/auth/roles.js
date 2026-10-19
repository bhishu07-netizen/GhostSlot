// Account roles as the UI shows them. The server (server/security.js) holds
// the authoritative lists and checks every permission; this file is copy only.
import { GraduationCap, Presentation, Wrench } from "lucide-react";

export const ROLE_META = {
  student: {
    label: "Student", icon: GraduationCap,
    idLabel: "student roll number", idExample: "23BCS10432",
    can: "Find and book free rooms · view the campus twin",
    tagline: "AI-powered campus space intelligence — not just a room directory.",
    steps: [["Search", "tell us what you need"], ["Match", "AI finds the best space"], ["Book", "it's yours, don't ghost it"]],
  },
  faculty: {
    label: "Faculty", icon: Presentation,
    idLabel: "employee ID", idExample: "E21045",
    deptLabel: "Department",
    departments: ["CSE", "AIT-CSE", "ECE", "Mechanical", "Civil", "Applied Sciences", "Management", "Other"],
    can: "Your classes · book rooms for extra classes · view the campus twin",
    tagline: "Your teaching day, and a room for every extra class.",
    steps: [["Check", "your classes today"], ["Find", "a room that fits the section"], ["Book", "the extra class"]],
  },
  facilities: {
    label: "Facilities", icon: Wrench,
    idLabel: "staff ID", idExample: "FMS2041",
    deptLabel: "Team",
    departments: ["Electrical", "Plumbing", "Housekeeping", "Estate office"],
    can: "Log energy & water readings · handle twin alerts",
    tagline: "Live alerts for wasted power and water, and where to send someone.",
    steps: [["Spot", "the alert"], ["Fix", "send someone, mark it"], ["Log", "the meter reading"]],
  },
};
export const ROLE_ORDER = ["student", "faculty", "facilities"];

// Bell-menu items per role (demo copy).
export const ROLE_NOTIFS = {
  student: [
    { id: 1, text: "Lab 9 just ghosted its 11am class. It's yours if you want it.", time: "2m ago" },
    { id: 2, text: "You left A2·104 with 40 min still on the clock. Bold of you.", time: "1h ago" },
    { id: 3, text: "D Block LT-3 is about to get feral at 1pm. Book elsewhere.", time: "3h ago" },
  ],
  faculty: [
    { id: 1, text: "CSE Lab 9 is free 11:00–15:00 today if you need a lab for a make-up session.", time: "5m ago" },
    { id: 2, text: "A2·104 is used only 22% of class hours this week. Ask the timetable office if you need a fixed slot.", time: "2h ago" },
  ],
  facilities: [
    { id: 1, text: "New energy alert: a room is powered on with nobody inside. See Operations.", time: "just now" },
    { id: 2, text: "Night water spike flagged in one building. Check for a running cistern.", time: "6h ago" },
  ],
};
