export function UiIcon({ name }) {
  const paths = {
    Screen: <path d="M4 5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M9 21h6" />,
    Layout: <path d="M4 5h16v14H4z M4 9h16 M4 13h16" />,
    Text: <path d="M5 6h14 M5 11h10 M5 16h14 M12 11v5" />,
    Media: <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z M9 10.5l3-3 3 3 M8.5 14l2.5-2.5 2 2 2-2 1.5 1.5" />,
    Input: <path d="M4 8.5h16v7H4z M7 8.5v7" />,
    Button: <path d="M7 9.5h10a3 3 0 0 1 3 3v-1a0 0 0 0 1 0 0v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1a0 0 0 0 1 0 0v1a3 3 0 0 1 3-3z" />,
    Progress: <path d="M4 10h16v4H4z M4 12h12" />,
    Html: <path d="M9 8.5L5.5 12 9 15.5 M15 8.5l3.5 3.5L15 15.5" />,
    Divider: <path d="M4 12h16" />,
    Rectangle: <path d="M5 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />,
    Ellipse: <path d="M12 5.5c4.4 0 8 2.9 8 6.5s-3.6 6.5-8 6.5-8-2.9-8-6.5 3.6-6.5 8-6.5z" />,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || null}</svg>;
}
