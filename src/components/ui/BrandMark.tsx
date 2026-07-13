import blackMark from "../../assets/bunkfy-mark.svg";
import whiteMark from "../../assets/bunkfy-mark-white.svg";
import simpleBoldWhiteMark from "../../assets/bunkfy-mark-white-simple-bold.svg";
import simpleWhiteMark from "../../assets/bunkfy-mark-white-simple.svg";

type BrandMarkProps = {
  variant: "black" | "white" | "simple-white" | "simple-white-bold";
  height?: number;
  framed?: boolean;
  className?: string;
};

export function BrandMark({ variant, height = 44, framed = false, className = "" }: BrandMarkProps) {
  const source = variant === "simple-white-bold" ? simpleBoldWhiteMark : variant === "simple-white" ? simpleWhiteMark : variant === "white" ? whiteMark : blackMark;
  const markHeight = framed ? Math.round(height * 0.75) : height;
  const image = (
    <img
      src={source}
      width={Math.round(markHeight * 1.125)}
      height={markHeight}
      alt=""
      aria-hidden="true"
      className="block object-contain"
    />
  );

  if (framed) {
    return (
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-2xl bg-primary ${className}`}
        style={{ width: height, height }}
      >
        {image}
      </span>
    );
  }

  return <span className={`block shrink-0 ${className}`}>{image}</span>;
}
