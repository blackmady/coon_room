/** @jsx h */
import { h, PageProps, tw } from "../client_deps.ts";
import {
  createOAuthUserAuth,
  getCookies,
  HandlerContext,
  setCookie,
  supabase,
} from "../server_deps.ts";
import Room from "./[room].tsx";

export async function handler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  // Get cookie from request header and parse it
  const maybeAccessToken = getCookies(req.headers)["deploy_chat_token"];
  if (maybeAccessToken) {
    const { data, error } = await supabase
      .from("users")
      .select("login,avatar_url")
      .eq("access_token", maybeAccessToken);
    if (error) {
      console.log(error);
      return new Response(error.message, { status: 400 });
    }

    if (data.length !== 0) {
      return ctx.render({ rooms: await loadRooms() });
    }
  }

  // This is an oauth callback request.
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return ctx.render(false);
  }

  const request = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    body: JSON.stringify({
      client_id: Deno.env.get("CLIENT_ID"),
      client_secret: Deno.env.get("CLIENT_SECRET"),
      code,
    }),
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  });
  const { access_token } = await request.json();

  if (!access_token) {
    return ctx.render(false);
  }

  // Get user info
  const userInfoRequest = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `token ${access_token}`,
    },
  });
  const { login, id, avatar_url } = await userInfoRequest.json();

  // Insert user into database
  const { data, error } = await supabase
    .from("users")
    .upsert([
      {
        login,
        id,
        avatar_url,
        access_token,
      },
    ], { returning: "minimal" });
  if (error) {
    console.log(error);
    return new Response(error.message, { status: 400 });
  }

  const response = await ctx.render({
    rooms: await loadRooms(),
  });
  setCookie(response.headers, {
    name: "deploy_chat_token",
    value: access_token,
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
  });
  return response;
}

async function loadRooms() {
  const rooms = await supabase.from("rooms_with_activity").select(
    "id,name,last_message_at",
  );
  if (rooms.error) {
    throw new Error(rooms.error.message);
  }
  return rooms.data;
}

export default function Main(
  { url, data }: PageProps<
    { rooms: { id: number; name: string; last_message_at: string }[] }
  >,
) {
  if (data) {
    // Already logged in. Show list of rooms.
    return (
      <div
        className={tw
          `flex justify-center content-center items-center min-h-screen`}
      >
        <ul role="list" className={tw`divide-y divide-gray-200`}>
          {data.rooms.map((room) => {
            return (
              <li key={room.id} className={tw`py-4 flex`}>
                <a
                  href={new URL(room.id.toString(), url).href}
                  className={tw`ml-3 block`}
                >
                  <p className={tw`text-sm font-medium text-gray-900`}>
                    {room.name}
                  </p>
                  <p className={tw`text-sm text-gray-500`}>
                    {room.last_message_at
                      ? new Intl.DateTimeFormat("en-US", {
                        dateStyle: "long",
                        timeStyle: "medium",
                      }).format(new Date(room.last_message_at).getTime())
                      : "No messages"}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <div
      className={tw`min-h-screen flex justify-center items-center flex-col`}
    >
      <a
        href="/api/login"
        className={tw
          `bg-gray-900 text-gray-100 hover:text-white shadow font-bold text-sm py-3 px-4 rounded flex justify-start items-center cursor-pointer mt-2`}
      >
        <svg
          viewBox="0 0 24 24"
          className={tw`fill-current mr-4 w-6 h-6`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
        <span>Sign up with Github</span>
      </a>
    </div>
  );
}
