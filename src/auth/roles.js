// Account roles as the UI shows them. The server (server/security.js) holds
// the authoritative lists and checks every permission; this file is copy only.
import { GraduationCap, Presentation } from "lucide-react";

export const ROLE_META = {
  student: {
    label: "Student", icon: GraduationCap,
    idLabel: "student roll number", idExample: "23BCS10432",
    can: "Find empty rooms from the timetable · book one for group study, projects or prep",
    tagline: "Every empty classroom on campus, straight from the timetable.",
    steps: [["Search", "tell us what you need"], ["Find", "an empty room right now"], ["Book", "for group study, projects or prep"]],
  },
  faculty: {
    label: "Faculty", icon: Presentation,
    idLabel: "employee ID", idExample: "E21045",
    deptLabel: "Department",
    departments: ["CSE", "AIT-CSE", "ECE", "Mechanical", "Civil", "Applied Sciences", "Management", "Other"],
    can: "Your classes · find an idle room · book it for an extra class or other work",
    tagline: "Your teaching day, and an idle room for every extra class.",
    steps: [["Check", "your classes today"], ["Find", "an idle room that fits"], ["Book", "for an extra class or other work"]],
  },
};
export const ROLE_ORDER = ["student", "faculty"];
