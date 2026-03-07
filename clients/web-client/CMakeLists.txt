find_program(NPM_EXECUTABLE NAMES npm REQUIRED)

set(WEB_CLIENT_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

add_custom_target(web-client-setup
	COMMAND "${NPM_EXECUTABLE}" ci
	WORKING_DIRECTORY "${WEB_CLIENT_DIR}"
	USES_TERMINAL
)

add_custom_target(web-client-build
	COMMAND "${NPM_EXECUTABLE}" run build:web
	WORKING_DIRECTORY "${WEB_CLIENT_DIR}"
	USES_TERMINAL
)
add_dependencies(web-client-build web-client-setup)

add_custom_target(web-client-test
	COMMAND "${NPM_EXECUTABLE}" test
	WORKING_DIRECTORY "${WEB_CLIENT_DIR}"
	USES_TERMINAL
)
add_dependencies(web-client-test web-client-setup)

add_custom_target(web-client-electron
	COMMAND "${NPM_EXECUTABLE}" run build:electron
	WORKING_DIRECTORY "${WEB_CLIENT_DIR}"
	USES_TERMINAL
)
add_dependencies(web-client-electron web-client-setup)
