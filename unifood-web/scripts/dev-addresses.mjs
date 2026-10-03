import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

console.log(`\nProyecto: ${fileURLToPath(new URL("../../", import.meta.url))}`);
console.log("Local: http://localhost:3000");
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
      console.log(`En red (${name}): http://${address.address}:3000`);
    }
  }
}
console.log("Entrada inicial: login y registro.\n");
