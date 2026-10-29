import type {ReactNode} from 'react';
import {ArrowLeft,ArrowUpRight,Check,LockKeyhole,ShieldCheck} from 'lucide-react';
import styles from './LegalPage.module.css';

export const legalUpdated='29 October 2026';
/** Publish only operator details that have been supplied for public display. */
export const legalContact={
 operatorName:null as string|null,
 privacyEmail:'sarthakchaudharys253@gmail.com' as string|null,
 supportEmail:null as string|null,
 supportUrl:null as string|null,
};
export type LegalDocument='overview'|'privacy'|'terms'|'acceptable-use'|'support';
export interface LegalSection {id:string;title:string;content:ReactNode}
const documents:[LegalDocument,string,string][]=[['overview','/legal/','Overview'],['privacy','/privacy/','Privacy policy'],['terms','/terms/','Terms of use'],['acceptable-use','/acceptable-use/','Acceptable use'],['support','/support/','Contact & safety']];

function Mark(){return <svg width="27" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5.5 7.5 16 26 26.5 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M8.5 8.5c4-3 11-3 15 0M11 12c3-2 7-2 10 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".7"/></svg>}

export function LegalContact(){return <div className={styles.contactCard}>
 <h3>Contact the operator</h3>
 {legalContact.operatorName&&<p>Veilnivo is operated by {legalContact.operatorName}.</p>}
 {legalContact.privacyEmail?<p>Privacy, abuse and legal requests: <a href={`mailto:${legalContact.privacyEmail}`}>{legalContact.privacyEmail}</a></p>:<p>A public privacy, legal and abuse-reporting contact has not been supplied yet. Private requests cannot currently be submitted through this site. This page will list the contact when it is available.</p>}
 {legalContact.supportEmail&&<p>Support: <a href={`mailto:${legalContact.supportEmail}`}>{legalContact.supportEmail}</a></p>}
 {legalContact.supportUrl&&<p><a href={legalContact.supportUrl}>Support and reporting <ArrowUpRight size={14}/></a></p>}
 <p>Never include your password, chat-lock code, encryption keys, or unrelated private conversations in a request. A public issue tracker is not a confidential reporting channel.</p>
 </div>}

export function PolicyList({children}:{children:ReactNode}){return <ul className={styles.policyList}>{children}</ul>}
export function PolicyNote({children}:{children:ReactNode}){return <aside className={styles.note}><ShieldCheck size={19}/><div>{children}</div></aside>}

export default function LegalPage({document,title,description,summary,sections,children}:{document:LegalDocument;title:string;description:string;summary:string[];sections:LegalSection[];children?:ReactNode}){
 return <div className={styles.page}>
  <a className={styles.skip} href="#policy-content">Skip to policy</a>
  <header className={styles.header}>
   <a href="/" aria-label="Veilnivo home" className={styles.brand}><Mark/><strong>Veilnivo</strong><span>BETA</span></a>
   <a href="/" className={styles.back}><ArrowLeft size={16}/>Back to app</a>
  </header>
  <main className={styles.main} id="policy-content">
   <div className={styles.hero}>
    <span className={styles.eyebrow}><LockKeyhole size={14}/>PRIVACY, CLEARLY EXPLAINED</span>
    <h1>{title}</h1><p className={styles.description}>{description}</p>
    <div className={styles.date}><span className={styles.dot}/>Effective {legalUpdated}<span>•</span>Current public beta</div>
   </div>
   <nav className={styles.documentNav} aria-label="Legal documents">{documents.map(([id,href,label])=><a key={id} href={href} aria-current={document===id?'page':undefined}>{label}</a>)}</nav>
   <div className={styles.summary} aria-label="At a glance">{summary.map(text=><div key={text}><Check size={17}/><p>{text}</p></div>)}</div>
   {children}
   <div className={styles.documentGrid}>
    <nav className={styles.contents} aria-label="On this page"><span>ON THIS PAGE</span><ol>{sections.map(section=><li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
    <article className={styles.article}>{sections.map((section,index)=><section id={section.id} key={section.id} className={styles.section}><div className={styles.sectionHeading}><span>{String(index+1).padStart(2,'0')}</span><h2>{section.title}</h2></div><div className={styles.sectionContent}>{section.content}</div></section>)}</article>
   </div>
  </main>
  <footer className={styles.footer}><div><a href="/" className={styles.footerBrand}><Mark/>Veilnivo</a><p>No phone number or email required. Privacy still has limits.</p></div><nav aria-label="Footer legal links">{documents.filter(([id])=>id!=='overview').map(([id,href,label])=><a key={id} href={href}>{label}</a>)}</nav></footer>
 </div>;
}

export function LegalCards(){return <div className={styles.cards}>
 <a href="/privacy/"><span>01 <ArrowUpRight size={18}/></span><h2>Privacy policy</h2><p>What stays on your device, what reaches the server, and the choices you control.</p></a>
 <a href="/terms/"><span>02 <ArrowUpRight size={18}/></span><h2>Terms of use</h2><p>Your account, the beta service, availability, and your responsibilities.</p></a>
 <a href="/acceptable-use/"><span>03 <ArrowUpRight size={18}/></span><h2>Acceptable use</h2><p>Rules for using Veilnivo safely and lawfully, including reporting and legal requests.</p></a>
 <a href="/support/"><span>04 <ArrowUpRight size={18}/></span><h2>Contact & safety</h2><p>Find current support options, reporting guidance, and information for privacy or legal requests.</p></a>
 </div>}
