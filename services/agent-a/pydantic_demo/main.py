import asyncio

# from general_agent import general_agent
from pydantic_demo.general_agent import general_agent

async def main():
    question = input("You: ")

    result = await general_agent.run(question)

    print("\nAssistant:")
    print(result.output)


if __name__ == "__main__":
    asyncio.run(main())
