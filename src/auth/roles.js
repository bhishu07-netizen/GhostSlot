// Account roles as the UI shows them. The server (server/security.js) holds
// the authoritative lists and checks every permission; this file is copy only.
import { GraduationCap, Presentation } from "lucide-react";

export const ROLE_META = {
  student: {
    label: "Student", icon: GraduationCap,
    idLabel: "student roll number", idExample: "23BCS10432",
    can: "Find empty rooms from the timetable · book one",
    tagline: "Every empty classroom on campus, straight from the timetable.",
    steps: [["Search", "tell us what you need"], ["Find", "an empty room right now"], ["Book", "it's yours till you leave"]],
  },
  faculty: {
    label: "Faculty", icon: Presentation,
    idLabel: "employee ID", idExample: "E21045",
    deptLabel: "Department",
    departments: ["CSE", "AIT-CSE", "ECE", "Mechanical", "Civil", "Applied Sciences", "Management", "Other"],
    can: "Your classes · find an empty room · book it for an extra class",
    tagline: "Your teaching day, and an empty room for every extra class.",
    steps: [["Check", "your classes today"], ["Find", "an empty room that fits"], ["Book", "the extra class"]],
  },
};
export const ROLE_ORDER = ["student", "faculty"];
