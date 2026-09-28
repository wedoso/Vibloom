export default function BrandMark({ className = "" }: { className?: string }) {
  return <img className={className} src={`${import.meta.env.BASE_URL}vibloom-icon.png`} alt="" aria-hidden="true" width={34} height={34} />;
}
