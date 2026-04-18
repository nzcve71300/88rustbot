import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";

const AnimatedSearchBar = ({
  value,
  onChange,
  suggestionNames,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestionNames: string[];
}) => {
  const [placeholderText, setPlaceholderText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isFocused || value.length > 0) return;

    const names = suggestionNames.length > 0 ? suggestionNames : ["88 Rust"];
    let nameIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let timeout: ReturnType<typeof setTimeout>;

    const tick = () => {
      const current = names[nameIndex];
      if (!isDeleting) {
        charIndex++;
        setPlaceholderText(`Search "${current.slice(0, charIndex)}"`);
        if (charIndex === current.length) {
          timeout = setTimeout(() => { isDeleting = true; tick(); }, 1800);
          return;
        }
        timeout = setTimeout(tick, 80);
      } else {
        charIndex--;
        setPlaceholderText(charIndex > 0 ? `Search "${current.slice(0, charIndex)}"` : "Search...");
        if (charIndex === 0) {
          isDeleting = false;
          nameIndex = (nameIndex + 1) % names.length;
          timeout = setTimeout(tick, 400);
          return;
        }
        timeout = setTimeout(tick, 40);
      }
    };

    timeout = setTimeout(tick, 600);
    return () => clearTimeout(timeout);
  }, [isFocused, value, suggestionNames]);

  return (
    <div className={`relative flex items-center rounded-lg border bg-card transition-all duration-300 ${isFocused ? "border-primary glow-yellow" : "border-border"}`}>
      <Search className={`absolute left-4 h-4 w-4 transition-colors duration-200 ${isFocused ? "text-primary" : "text-muted-foreground"}`} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={isFocused ? "Type a server name..." : placeholderText || "Search..."}
        className="w-full bg-transparent py-3 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  );
};

export default AnimatedSearchBar;
