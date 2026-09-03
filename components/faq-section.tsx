"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, HelpCircle } from "lucide-react"

const faqs = [
  {
    question: "Qu'est-ce que LIVECAM ?",
    answer: "LIVECAM est une application de transformation faciale en temps reel qui vous permet de changer votre apparence pendant vos appels video. Rendez-vous sur chapcam.com pour decouvrir toutes nos fonctionnalites."
  },
  {
    question: "Est-ce que ca fonctionne avec WhatsApp, Zoom, Teams ?",
    answer: "Oui ! LIVECAM fonctionne avec toutes les applications de visioconference : WhatsApp, Telegram, Zoom, Microsoft Teams, Google Meet, Discord, Skype, TikTok Live, et bien d'autres. Plus d'infos sur chapcam.com."
  },
  {
    question: "Quels sont les tarifs disponibles ?",
    answer: "LIVECAM propose plusieurs formules adaptees a vos besoins : Starter (10 000 FCFA pour 1 jour), Premium (50 000 FCFA pour 90 jours), VIP PRO (85 000 FCFA pour 365 jours) et VIP DEBOUT (150 000 FCFA, 60 min). Consultez tous les details sur chapcam.com."
  },
  {
    question: "Comment fonctionnent les points ?",
    answer: "1 point = 1 seconde de transformation. Le plan Starter offre 500 points (8 min 20 sec), Premium offre 2 500 points (41 min 40 sec), VIP PRO offre 4 250 points (1 h 10 min 50 sec) et VIP DEBOUT offre 7 200 points (2 h)."
  },
  {
    question: "Mes donnees sont-elles securisees ?",
    answer: "Absolument. Chez LIVECAM, la securite de vos donnees est notre priorite. Vos informations sont protegees et nous ne les partageons jamais avec des tiers."
  },
  {
    question: "Comment contacter le support ?",
    answer: "Visitez chapcam.com pour decouvrir toutes les options d'aide et de contact. Notre equipe LIVECAM repond generalement sous 24 heures."
  }
]

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section id="faq" className="relative py-24 px-6">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#8b5cf6]/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, type: "spring" }}
            className="inline-flex items-center gap-2 bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 px-4 py-2 rounded-full mb-6"
          >
            <HelpCircle className="w-4 h-4 text-[#8b5cf6]" />
            <span className="text-[#8b5cf6] text-sm font-medium">FAQ</span>
          </motion.div>
          
          <h2 className="text-4xl lg:text-5xl font-black text-white mb-4">
            Questions{" "}
            <span className="bg-gradient-to-r from-[#8b5cf6] to-[#00d4ff] bg-clip-text text-transparent">
              frequentes
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Tout ce que vous devez savoir sur LIVECAM et le face swap en temps reel
          </p>
        </motion.div>

        {/* FAQ Items */}
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <div
                className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                  openIndex === index
                    ? "bg-white/5 border-[#8b5cf6]/50 shadow-[0_0_30px_rgba(139,92,246,0.15)]"
                    : "bg-white/[0.02] border-white/10 hover:border-white/20"
                }`}
              >
                <button
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <span className={`font-semibold text-lg transition-colors ${
                    openIndex === index ? "text-white" : "text-gray-300"
                  }`}>
                    {faq.question}
                  </span>
                  <motion.div
                    animate={{ rotate: openIndex === index ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                    className={`flex-shrink-0 ml-4 ${
                      openIndex === index ? "text-[#8b5cf6]" : "text-gray-500"
                    }`}
                  >
                    <ChevronDown className="w-5 h-5" />
                  </motion.div>
                </button>
                
                <AnimatePresence>
                  {openIndex === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="px-6 pb-6">
                        <div className="h-px bg-gradient-to-r from-transparent via-[#8b5cf6]/30 to-transparent mb-4" />
                        <p className="text-gray-400 leading-relaxed">
                          {faq.answer}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Contact CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 text-center"
        >
          <p className="text-gray-400 mb-4">
            Vous avez d&apos;autres questions ?
          </p>
          <a
            href="https://chapcam.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#00ff88] hover:bg-[#00dd77] text-black px-6 py-3 rounded-full font-semibold transition-all shadow-[0_0_20px_rgba(0,255,136,0.4)] hover:shadow-[0_0_30px_rgba(0,255,136,0.6)]"
          >
            Visiter chapcam.com
          </a>
        </motion.div>
      </div>
    </section>
  )
}
