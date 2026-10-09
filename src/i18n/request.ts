import { getRequestConfig } from "next-intl/server";

// Minimal stub so the scaffold builds. Wave 2 replaces it with the cookie-based locale resolution
// and the namespace-merged message loading (DT-31).
export default getRequestConfig(async () => {
  return {
    locale: "es",
    messages: {},
  };
});
