import { Suspense } from "react";
import Waitlist from "../../components/Waitlist";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";

export const metadata = {
  title: "Early Access | Loudentify",
  description:
    "Join the Loudentify waitlist for our January 2027 launch.",
};

export default function EarlyAccessPage() {
  return (
    <>
      <Navbar />

      <Suspense
        fallback={
          <main
            style={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              background: "#011627",
              color: "#fdfffc",
            }}
          >
            Loading Loudentify...
          </main>
        }
      >
        <Waitlist />
      </Suspense>

      <Footer />
    </>
  );
}