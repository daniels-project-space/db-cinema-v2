import React from "react";
import { createRoot } from "react-dom/client";
import { Footer } from "@/components/Footer";

const mount = document.getElementById("root");
if (!mount) throw new Error("Footer fixture root is missing");
void Footer().then((footer) => createRoot(mount).render(footer));
