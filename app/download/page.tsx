import { Header } from "@/components/header"
import { getDesktopDownloadUrl, getDesktopDownloadUrlMac } from "@/lib/pc-offer"
import DownloadContent from "./download-content"

export default function DownloadPage() {
  const windowsUrl = getDesktopDownloadUrl()
  const macUrl = getDesktopDownloadUrlMac()

  return (
    <main className="min-h-screen bg-[#0a0e1a]">
      <Header />
      <DownloadContent
        windowsUrl={windowsUrl}
        macUrl={macUrl}
        macArmUrl={macUrl}
        version="1.0.23"
      />
    </main>
  )
}