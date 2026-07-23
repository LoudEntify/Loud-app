export const metadata = {
  title: 'Loudentify pilot',
  description: 'Live performance pilot build',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#111', color: '#eee' }}>
        {children}
      </body>
    </html>
  );
}
