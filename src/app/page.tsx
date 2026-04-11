import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to dashboard (auth check happens in dashboard layout)
  redirect("/dashboard");
}
