import Image from "next/image";
import Link from "next/link";
import styles from "./AuthScreen.module.css";
import { loginPath, type AuthEntrypoint } from "../validation";

export default function Brand({
  large = false,
  entrypoint,
}: {
  large?: boolean;
  entrypoint: AuthEntrypoint;
}) {
  return (
    <Link
      href={loginPath(entrypoint)}
      className={`${styles.brand} ${large ? styles.loginBrand : ""}`}
      aria-label="UniFood — inicio"
    >
      <span className={styles.logo}>
        <Image
          src="/unifood-logo.png"
          width={110}
          height={110}
          alt=""
          priority
        />
      </span>
      <span>
        Uni<span>Food</span>
      </span>
    </Link>
  );
}

export function Waves() {
  return (
    <svg
      className={styles.waves}
      viewBox="0 0 600 180"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0 44C190 0 352 188 600 148V180H0Z"
        fill="#d6edff"
        fillOpacity=".8"
      />
      <path
        d="M0 210C220 125 360-20 600 0V180H0Z"
        fill="#91cfff"
        fillOpacity=".35"
      />
    </svg>
  );
}
