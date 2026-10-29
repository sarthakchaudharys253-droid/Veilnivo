import type {Metadata} from 'next';
import LegalPage from '@/components/legal/LegalPage';
import {privacySections} from '@/components/legal/policy-content';
export const metadata:Metadata={title:'Privacy policy — Veilnivo',description:'How Veilnivo handles encrypted messages, account data, cookies, optional AI, deletion and lawful requests.'};
export default function PrivacyPage(){return <LegalPage document="privacy" title="Your privacy. In plain language." description="Understand what stays on your device, what the service needs to deliver messages, and where privacy has limits." summary={['No phone number or email is required to create an account.','Peer content is encrypted; account and routing metadata remain visible.','Ollama Cloud is inactive. No AI scans your private chats.']} sections={privacySections}/>}
