
import { Suspense } from "react";
import Waitlist from "../../components/Waitlist";

export const metadata = {
  title: "Early Access | Loudentify",
  description:
    "Join the Loudentify waitlist for our January 2027 launch.",
};

export default function EarlyAccessPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Waitlist />
    </Suspense>
  );
}
