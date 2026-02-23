import fetch, { Headers } from 'node-fetch'

export async function getRequest(url: string, token: string): Promise<unknown> {
	const header: Headers = new Headers()
	header.append('Accept', 'application/json')
	if (token != '') {
		header.append('Authorization', `Bearer ${token}`)
	}
	console.log('url = ', url)
	console.log('token = ', token)
	console.log('header = ', header)
	const response = await fetch(url, {
		method: 'GET',
		headers: header,
	})
	console.log('GET Request returns: ', response)
	if (!response.ok) {
		throw new Error(`GET request failed: ${response.status} ${response.statusText}`)
	}

	return response.json()
}

export async function postRequest(url: string, token: string, body: unknown): Promise<unknown> {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	})

	if (!response.ok) {
		throw new Error(`POST request failed: ${response.status} ${response.statusText}`)
	}
	return response.json()
}
