import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "模型智能测试",
  description: "鹈鹕测试站",
  referrer: 'no-referrer',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
