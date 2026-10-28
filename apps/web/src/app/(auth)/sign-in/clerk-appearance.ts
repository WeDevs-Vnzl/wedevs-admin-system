import type { ComponentProps } from "react";
import type { ClerkProvider, SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;
type Localization = NonNullable<ComponentProps<typeof ClerkProvider>["localization"]>;

// Sign-in appearance (wireframe 4.1, IOU-05): project tokens through CSS variables, so both themes follow.
// better-ui: the surrounding card owns elevation (shadow), Clerk's own card is flattened; radius nests
// (card rounded-2xl = field rounded-lg + padding); transitions on interactive state only, gated behind
// reduced motion; press scale 0.96 on the primary button. Invitation only: no sign-up footer (PRD §4.2).
export const signInAppearance: Appearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "transparent",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorNeutral: "var(--foreground)",
    colorDanger: "var(--destructive)",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-sans)",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-0 rounded-none bg-transparent",
    card: "p-0 shadow-none border-0 bg-transparent gap-6",
    header: "hidden",
    footer: "bg-transparent",
    footerAction: "hidden",
    socialButtonsBlockButton:
      "h-10 rounded-lg border border-border bg-background shadow-none transition-[background-color,transform] duration-150 motion-reduce:transition-none hover:bg-muted active:scale-[0.96] motion-reduce:active:scale-100",
    formButtonPrimary:
      "h-10 rounded-lg shadow-none transition-[opacity,transform] duration-150 motion-reduce:transition-none active:scale-[0.96] motion-reduce:active:scale-100",
    formFieldInput:
      "h-10 rounded-lg border border-input shadow-none transition-colors duration-150 motion-reduce:transition-none focus:border-ring",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground",
  },
};

// Minimal ES overrides for the sign-in flow. `@clerk/localizations` is not a dependency of this repo
// (this wave changes none), so only the strings the invitation-only flow shows are overridden.
const ES_LOCALIZATION: Localization = {
  locale: "es-ES",
  formFieldLabel__emailAddress: "Correo electrónico",
  formFieldInputPlaceholder__emailAddress: "nombre@empresa.com",
  formButtonPrimary: "Continuar",
  dividerText: "o",
  socialButtonsBlockButton: "Continuar con {{provider|titleize}}",
  signIn: {
    start: {
      title: "Iniciar sesión",
      subtitle: "Acceso solo por invitación",
    },
    emailCode: {
      title: "Revisa tu correo",
      subtitle: "Introduce el código de verificación que te enviamos",
      formTitle: "Código de verificación",
      resendButton: "Reenviar código",
    },
  },
};

/** Clerk localization following the active app locale; English is Clerk's default. */
export function clerkLocalization(locale: string): Localization | undefined {
  return locale === "es" ? ES_LOCALIZATION : undefined;
}
