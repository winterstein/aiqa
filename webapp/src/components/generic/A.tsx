import { Link } from 'react-router-dom';		

/**
 * a link
 */
export default function A({ href, children }: { href: string, children: React.ReactNode }) {
	return <a href={href} >{children}</a>;
}
